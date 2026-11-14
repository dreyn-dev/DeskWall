//! CPU and GPU load of DeskWall for the settings indicator ("CPU 4% · GPU 9%").
//!
//! The scenes run in WebView2 child processes (browser, renderer, GPU), so the load is summed
//! over our process tree. CPU comes from process times; GPU from the Windows "GPU Engine"
//! performance counters (the same source as Task Manager): per engine the utilisation of our
//! processes is summed, and the busiest engine is reported. Sampling only happens while a
//! settings view asks for it (every couple of seconds).

use serde::Serialize;

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct LoadStats {
    /// Percent of the whole machine (all cores), `None` until two samples exist.
    pub cpu: Option<f32>,
    /// Percent of the busiest GPU engine, `None` when counters are unavailable.
    pub gpu: Option<f32>,
}

/// Parses `pid_1234_luid_0x0_0x1_phys_0_eng_3_engtype_3D` into (pid, engine key).
pub fn parse_gpu_instance(name: &str) -> Option<(u32, &str)> {
    let rest = name.strip_prefix("pid_")?;
    let (pid, engine) = rest.split_once('_')?;
    let engine = engine.split("_engtype_").next()?;
    Some((pid.parse().ok()?, engine))
}

#[cfg(windows)]
pub use imp::Sampler;

#[cfg(not(windows))]
#[derive(Default)]
pub struct Sampler;

#[cfg(not(windows))]
impl Sampler {
    pub fn sample(&mut self) -> LoadStats {
        LoadStats::default()
    }
}

#[cfg(windows)]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::time::Instant;

    use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, FILETIME};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Performance::{
        PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhOpenQueryW,
    };
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::{PCWSTR, w};

    use super::{LoadStats, parse_gpu_instance};

    struct Gpu {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
    }

    // PDH handles are plain handles; the sampler is only used behind a mutex.
    unsafe impl Send for Gpu {}

    impl Drop for Gpu {
        fn drop(&mut self) {
            unsafe { PdhCloseQuery(self.query) };
        }
    }

    #[derive(Default)]
    pub struct Sampler {
        last: Option<Instant>,
        times: HashMap<u32, u64>,
        gpu: Option<Gpu>,
        gpu_failed: bool,
    }

    impl Sampler {
        pub fn sample(&mut self) -> LoadStats {
            let pids = process_tree(std::process::id());
            LoadStats {
                cpu: self.cpu(&pids),
                gpu: self.gpu(&pids),
            }
        }

        fn cpu(&mut self, pids: &HashSet<u32>) -> Option<f32> {
            let now = Instant::now();
            let mut times = HashMap::new();
            let mut busy = 0u64;
            for &pid in pids {
                let Some(t) = cpu_time(pid) else { continue };
                if let Some(prev) = self.times.get(&pid) {
                    busy += t.saturating_sub(*prev);
                }
                times.insert(pid, t);
            }
            self.times = times;
            let last = self.last.replace(now)?;
            let cores = std::thread::available_parallelism().map_or(1, |n| n.get()) as f64;
            // Process times are in 100 ns units.
            let wall = now.duration_since(last).as_secs_f64() * 1e7 * cores;
            (wall > 0.0).then(|| ((busy as f64 / wall) * 100.0).clamp(0.0, 100.0) as f32)
        }

        fn gpu(&mut self, pids: &HashSet<u32>) -> Option<f32> {
            if self.gpu_failed {
                return None;
            }
            if self.gpu.is_none() {
                self.gpu = open_gpu_query();
                if self.gpu.is_none() {
                    self.gpu_failed = true;
                }
                // Rate counters need two collections; the first one only primes the query.
                return None;
            }
            let gpu = self.gpu.as_ref()?;
            unsafe {
                if PdhCollectQueryData(gpu.query) != ERROR_SUCCESS.0 {
                    return None;
                }
            }
            let items = read_array(gpu.counter)?;
            let mut engines: HashMap<String, f64> = HashMap::new();
            for (name, value) in items {
                if let Some((pid, engine)) = parse_gpu_instance(&name)
                    && pids.contains(&pid)
                {
                    *engines.entry(engine.to_owned()).or_default() += value;
                }
            }
            Some(
                engines
                    .values()
                    .copied()
                    .fold(0.0, f64::max)
                    .clamp(0.0, 100.0) as f32,
            )
        }
    }

    fn open_gpu_query() -> Option<Gpu> {
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != ERROR_SUCCESS.0 {
                return None;
            }
            let mut counter = PDH_HCOUNTER::default();
            let path = w!("\\GPU Engine(*)\\Utilization Percentage");
            if PdhAddEnglishCounterW(query, path, 0, &mut counter) != ERROR_SUCCESS.0
                || PdhCollectQueryData(query) != ERROR_SUCCESS.0
            {
                PdhCloseQuery(query);
                return None;
            }
            Some(Gpu { query, counter })
        }
    }

    fn read_array(counter: PDH_HCOUNTER) -> Option<Vec<(String, f64)>> {
        unsafe {
            let mut size = 0u32;
            let mut count = 0u32;
            let status =
                PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
            if status != PDH_MORE_DATA || size == 0 {
                return None;
            }
            // The buffer holds the items followed by their names; keep it 8-byte aligned.
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            let items = buf.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
            if PdhGetFormattedCounterArrayW(
                counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                Some(items),
            ) != ERROR_SUCCESS.0
            {
                return None;
            }
            let slice = std::slice::from_raw_parts(items, count as usize);
            Some(
                slice
                    .iter()
                    .filter(|i| i.FmtValue.CStatus == 0)
                    .map(|i| {
                        (
                            i.szName.to_string().unwrap_or_default(),
                            i.FmtValue.Anonymous.doubleValue,
                        )
                    })
                    .collect(),
            )
        }
    }

    /// Our process and all its descendants (WebView2 browser, renderers, GPU process).
    fn process_tree(root: u32) -> HashSet<u32> {
        let mut parents: Vec<(u32, u32)> = Vec::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return HashSet::from([root]);
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut entry).is_ok() {
                loop {
                    parents.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        descendants(root, &parents)
    }

    pub(super) fn descendants(root: u32, parents: &[(u32, u32)]) -> HashSet<u32> {
        let mut tree = HashSet::from([root]);
        loop {
            let before = tree.len();
            for &(pid, ppid) in parents {
                if pid != ppid && tree.contains(&ppid) {
                    tree.insert(pid);
                }
            }
            if tree.len() == before {
                return tree;
            }
        }
    }

    fn cpu_time(pid: u32) -> Option<u64> {
        let ft = |f: FILETIME| (u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime);
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let (mut c, mut e, mut k, mut u) = Default::default();
            let ok = GetProcessTimes(handle, &mut c, &mut e, &mut k, &mut u).is_ok();
            let _ = CloseHandle(handle);
            ok.then(|| ft(k) + ft(u))
        }
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn descendants_follow_the_tree() {
            let parents = [(10, 1), (20, 10), (30, 20), (40, 2), (1, 1)];
            let tree = super::descendants(1, &parents);
            assert!(tree.contains(&30) && !tree.contains(&40));
        }

        #[test]
        fn sampler_reports_cpu_on_the_second_sample() {
            let mut sampler = super::Sampler::default();
            let first = sampler.sample();
            assert_eq!(first.cpu, None);
            let mut spin = 0u64;
            let until = std::time::Instant::now() + std::time::Duration::from_millis(300);
            while std::time::Instant::now() < until {
                spin = spin.wrapping_add(1);
            }
            std::hint::black_box(spin);
            let second = sampler.sample();
            let cpu = second.cpu.expect("cpu after two samples");
            assert!((0.0..=100.0).contains(&cpu), "cpu {cpu}");
            eprintln!("load sample: {second:?}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_gpu_instance;

    #[test]
    fn gpu_instance_names() {
        assert_eq!(
            parse_gpu_instance("pid_1234_luid_0x00000000_0x0000D1F0_phys_0_eng_3_engtype_3D"),
            Some((1234, "luid_0x00000000_0x0000D1F0_phys_0_eng_3"))
        );
        assert_eq!(parse_gpu_instance("_Total"), None);
        assert_eq!(parse_gpu_instance("pid_x_luid"), None);
    }
}
