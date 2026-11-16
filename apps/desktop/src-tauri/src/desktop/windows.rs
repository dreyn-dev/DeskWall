//! Windows desktop integration.
//!
//! * Attaches the wallpaper webview window *below* the desktop icon layer (Progman / WorkerW).
//! * Reads icon positions with the documented Shell API (`IShellWindows` → `IFolderView`),
//!   never by reading another process's memory.
//! * Detects full-screen apps (`SHQueryUserNotificationState` + foreground window checks).
//!
//! * One wallpaper window per monitor: the static `wallpaper` window on the primary monitor and
//!   `wallpaper-<id>` windows created at runtime for the others (each with its own theme).
//!
//! Everything COM-related runs on one dedicated STA thread that polls a few times per second.

use std::collections::BTreeSet;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITOR_DEFAULTTONULL, MONITORINFO,
    MONITORINFOEXW, MapWindowPoints, MonitorFromWindow, ScreenToClient,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, IServiceProvider,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    IFolderView, IShellBrowser, IShellWindows, QUNS_BUSY, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN, SHQueryUserNotificationState, SID_STopLevelBrowser,
    SVGIO_ALLVIEW, SWC_DESKTOP, SWFO_NEEDDISPATCH, ShellWindows,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GW_HWNDNEXT, GWL_EXSTYLE, GWL_STYLE, GetClassNameW,
    GetCursorPos, GetForegroundWindow, GetParent, GetSystemMetrics, GetWindow, GetWindowLongPtrW,
    GetWindowRect, HWND_BOTTOM, IsWindow, IsWindowVisible, IsZoomed, LWA_ALPHA,
    MONITORINFOF_PRIMARY, SM_SWAPBUTTON, SMTO_NORMAL, SPI_GETDESKWALLPAPER, SPI_SETDESKWALLPAPER,
    SPIF_SENDCHANGE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    SendMessageTimeoutW, SetLayeredWindowAttributes, SetParent, SetWindowLongPtrW, SetWindowPos,
    SystemParametersInfoW, WS_CAPTION, WS_CHILD, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_POPUP, WS_THICKFRAME, WindowFromPoint,
};
use windows::core::{BOOL, Interface, w};

use crate::protocol::{
    EVENT_POINTER, IconsPayload, PhysicalRect, PointerPayload, ScreenInfo, Size, WALLPAPER,
    is_wallpaper, screen_id, wallpaper_label,
};
use crate::state::HostState;

const POLL: Duration = Duration::from_millis(250);

/// Where the wallpaper window is parented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Windows 11 24H2+: layered child of Progman, directly below `SHELLDLL_DefView`.
    RaisedDesktop,
    /// Older builds: child of the WorkerW that sits behind the icon layer.
    WorkerW,
}

static RUNNING: AtomicBool = AtomicBool::new(false);

/// Wallpaper windows the pointer thread can see: label, HWND, monitor rect (screen space).
static WALLS: Mutex<Vec<(String, isize, RECT)>> = Mutex::new(Vec::new());

fn hwnd_of(window: &WebviewWindow) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0))
}

pub fn start(app: AppHandle, state: Arc<HostState>) -> tauri::Result<()> {
    if app.get_webview_window(WALLPAPER).is_none() {
        log::error!("wallpaper window missing");
        return Ok(());
    }
    RUNNING.store(true, Ordering::SeqCst);

    let pointer_app = app.clone();
    thread::Builder::new()
        .name("deskwall-desktop".into())
        .spawn(move || watcher(app, state))
        .map_err(|e| tauri::Error::Anyhow(e.into()))?;
    thread::Builder::new()
        .name("deskwall-pointer".into())
        .spawn(move || pointer_watcher(pointer_app))
        .map_err(|e| tauri::Error::Anyhow(e.into()))?;
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    RUNNING.store(false, Ordering::SeqCst);
    for (label, w) in app.webview_windows() {
        if !is_wallpaper(&label) {
            continue;
        }
        let _ = w.hide();
        if let Some(hwnd) = hwnd_of(&w) {
            unsafe {
                let _ = SetParent(hwnd, None);
            }
        }
    }
    refresh_system_wallpaper();
}

/// The monitors, for the settings page.
pub fn screens() -> Vec<ScreenInfo> {
    enum_screens()
        .into_iter()
        .map(|s| ScreenInfo {
            id: s.id,
            primary: s.primary,
            x: s.rect.left,
            y: s.rect.top,
            w: s.rect.right - s.rect.left,
            h: s.rect.bottom - s.rect.top,
        })
        .collect()
}

/// Re-applies the user's own wallpaper so the desktop repaints without us.
fn refresh_system_wallpaper() {
    unsafe {
        let mut buf = [0u16; 1024];
        if SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr().cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .is_ok()
        {
            let _ = SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                Some(buf.as_mut_ptr().cast()),
                SPIF_SENDCHANGE,
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Monitors
// ---------------------------------------------------------------------------------------------

/// A monitor as Windows reports it. `rect` is in virtual-screen physical pixels.
#[derive(Debug, Clone, PartialEq)]
struct Screen {
    id: String,
    rect: RECT,
    primary: bool,
}

/// All monitors, left to right.
fn enum_screens() -> Vec<Screen> {
    unsafe extern "system" fn each(mon: HMONITOR, _: HDC, _: *mut RECT, out: LPARAM) -> BOOL {
        unsafe {
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
            if GetMonitorInfoW(mon, &mut info.monitorInfo).as_bool() {
                let n = info.szDevice.iter().position(|&c| c == 0).unwrap_or(32);
                let device = String::from_utf16_lossy(&info.szDevice[..n]);
                (*(out.0 as *mut Vec<Screen>)).push(Screen {
                    id: screen_id(&device),
                    rect: info.monitorInfo.rcMonitor,
                    primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
                });
            }
            BOOL(1)
        }
    }
    let mut screens: Vec<Screen> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(each),
            LPARAM(&mut screens as *mut Vec<Screen> as isize),
        );
    }
    screens.sort_by_key(|s| (s.rect.left, s.rect.top));
    screens
}

/// One wallpaper window, attached under the icons of one monitor.
struct Wall {
    label: String,
    screen: Screen,
    hwnd: HWND,
    attached: Option<(Mode, HWND)>,
}

/// Makes the set of wallpaper windows match the monitors: the static `wallpaper` window on the
/// primary one, a `wallpaper-<id>` window on every other monitor not set to "off".
fn reconcile(
    app: &AppHandle,
    state: &HostState,
    walls: &mut Vec<Wall>,
    screens: &[Screen],
    off: &BTreeSet<String>,
) {
    let mut wanted: Vec<(String, &Screen)> = Vec::new();
    for s in screens {
        if s.primary {
            wanted.push((WALLPAPER.to_owned(), s));
        } else if !off.contains(&s.id) {
            wanted.push((wallpaper_label(&s.id), s));
        }
    }
    // Monitors were enumerated before the primary one was known (rare): fall back to the first.
    if !wanted.iter().any(|(l, _)| l == WALLPAPER)
        && let Some(first) = screens.first()
    {
        wanted.retain(|(_, s)| s.id != first.id);
        wanted.insert(0, (WALLPAPER.to_owned(), first));
    }

    // Close windows whose monitor is gone or turned off.
    walls.retain(|w| {
        let keep = wanted.iter().any(|(l, _)| *l == w.label);
        if !keep {
            log::info!("closing {}", w.label);
            if let Some(win) = app.get_webview_window(&w.label) {
                let _ = win.destroy();
            }
            state.remove_wall(&w.label);
        }
        keep
    });

    for (label, screen) in wanted {
        if let Some(w) = walls.iter_mut().find(|w| w.label == label) {
            if w.screen != *screen {
                // Moved, resized or became primary: attach and place again.
                w.screen = screen.clone();
                w.attached = None;
            }
            continue;
        }
        let window = match app.get_webview_window(&label) {
            Some(w) => Some(w),
            None => create_wall_window(app, &label, &screen.id),
        };
        let Some(hwnd) = window.as_ref().and_then(hwnd_of) else {
            log::warn!("no window for {label}");
            continue;
        };
        log::info!("{label} on {} ({:?})", screen.id, screen.rect);
        walls.push(Wall {
            label,
            screen: screen.clone(),
            hwnd,
            attached: None,
        });
    }

    let mut shared = WALLS.lock().unwrap_or_else(|e| e.into_inner());
    *shared = walls
        .iter()
        .map(|w| (w.label.clone(), w.hwnd.0 as isize, w.screen.rect))
        .collect();
}

fn create_wall_window(app: &AppHandle, label: &str, screen: &str) -> Option<WebviewWindow> {
    let url = WebviewUrl::App(format!("wallpaper.html?screen={screen}").into());
    WebviewWindowBuilder::new(app, label, url)
        .title("DeskWall Wallpaper")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .shadow(false)
        .build()
        .inspect_err(|e| log::error!("create {label}: {e}"))
        .ok()
}

// ---------------------------------------------------------------------------------------------
// Watcher thread
// ---------------------------------------------------------------------------------------------

fn watcher(app: AppHandle, state: Arc<HostState>) {
    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
            log::error!("CoInitializeEx failed; icon tracking disabled");
        }
    }
    let mut walls: Vec<Wall> = Vec::new();
    let mut known: Option<(Vec<Screen>, BTreeSet<String>)> = None;
    let mut shell: Option<IFolderView> = None;
    let mut last_icon_count = usize::MAX;

    while RUNNING.load(Ordering::SeqCst) {
        // Monitors plugged in or out, moved, or a monitor turned on / off in settings.
        let screens = enum_screens();
        let off = state
            .screens_off
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if known.as_ref() != Some(&(screens.clone(), off.clone())) {
            reconcile(&app, &state, &mut walls, &screens, &off);
            known = Some((screens, off));
        }

        // (Re)attach when Explorer restarted or replaced our parent.
        let ours: Vec<HWND> = walls.iter().map(|w| w.hwnd).collect();
        let mut prev: Option<(HWND, HWND)> = None; // (parent, last wallpaper placed under it)
        for w in &mut walls {
            let healthy = w.attached.is_some_and(|(_, parent)| unsafe {
                IsWindow(Some(parent)).as_bool() && GetParent(w.hwnd).ok() == Some(parent)
            });
            if !healthy {
                w.attached = unsafe { attach(w.hwnd, &w.screen.rect) };
                match w.attached {
                    Some((mode, _)) => log::info!("{} attached: {mode:?}", w.label),
                    None => log::warn!("could not attach {}; retrying", w.label),
                }
                shell = None;
            }
            if let Some((mode, parent)) = w.attached {
                let after = prev.filter(|(p, _)| *p == parent).map(|(_, h)| h);
                unsafe { keep_z_order(w.hwnd, mode, parent, after, &ours) };
                prev = Some((parent, w.hwnd));
            }
        }

        // Icons: read once, then hand each window the ones on its monitor.
        if shell.is_none() {
            shell = unsafe { desktop_folder_view() }
                .inspect_err(|e| log::debug!("folder view: {e}"))
                .ok();
        }
        if let Some(view) = &shell {
            match unsafe { read_icon_layout(view) } {
                Ok(layout) => {
                    for w in &walls {
                        let payload = unsafe { icons_for(&layout, w.hwnd) };
                        state.publish_icons(&app, &w.label, Some(payload), false);
                    }
                    if layout.points.len() != last_icon_count {
                        last_icon_count = layout.points.len();
                        log::info!("desktop icons: {last_icon_count}");
                    }
                }
                Err(e) => {
                    log::debug!("read icons failed: {e}");
                    shell = None;
                }
            }
        }

        // Full-screen / presentation detection, per monitor.
        let cover = unsafe { covered_monitor() };
        for w in &walls {
            let covered = match cover {
                Cover::None => false,
                Cover::All => true,
                Cover::Monitor(r) => r == w.screen.rect,
            };
            state.set_covered(&w.label, covered);
        }
        state.publish_pause(&app, false);

        thread::sleep(POLL);
    }
    unsafe { CoUninitialize() };
}

// ---------------------------------------------------------------------------------------------
// Cursor for theme interactions
// ---------------------------------------------------------------------------------------------

/// Windows sends mouse input to the icon layer, never to the wallpaper below it. Themes still
/// react to the cursor: this thread watches it and, while it is over the bare desktop, sends its
/// position and the left button state to the wallpaper of that monitor. Nothing is intercepted,
/// so icon clicks, drag-select and the desktop menu work as before.
fn pointer_watcher(app: AppHandle) {
    const OUTSIDE: PointerPayload = PointerPayload {
        x: 0,
        y: 0,
        inside: false,
        down: false,
    };
    let mut last: Option<(String, PointerPayload)> = None;
    while RUNNING.load(Ordering::SeqCst) {
        let now = unsafe { read_pointer() };
        if now != last {
            // Moving to another monitor (or off the desktop) clears the old one.
            if let Some((old, _)) = &last
                && now.as_ref().is_none_or(|(l, _)| l != old)
            {
                let _ = app.emit_to(old.as_str(), EVENT_POINTER, OUTSIDE);
            }
            if let Some((label, p)) = &now
                && let Err(err) = app.emit_to(label.as_str(), EVENT_POINTER, *p)
            {
                log::debug!("emit pointer failed: {err}");
            }
            last = now;
        }
        // ~60 Hz while over the desktop, a relaxed check otherwise
        let inside = last.is_some();
        thread::sleep(Duration::from_millis(if inside { 16 } else { 90 }));
    }
}

/// The wallpaper under the cursor and the cursor in its client space, or None.
unsafe fn read_pointer() -> Option<(String, PointerPayload)> {
    unsafe {
        let mut pt = POINT::default();
        GetCursorPos(&mut pt).ok()?;
        let hit = WindowFromPoint(pt);
        if hit.is_invalid() {
            return None;
        }
        let (label, wall) = {
            let walls = WALLS.lock().unwrap_or_else(|e| e.into_inner());
            let on_wall = walls.iter().find(|(_, h, _)| *h == hit.0 as isize);
            let found = on_wall.or_else(|| {
                if !is_desktop_layer(hit) {
                    return None;
                }
                walls.iter().find(|(_, _, r)| {
                    pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom
                })
            })?;
            (found.0.clone(), HWND(found.1 as *mut c_void))
        };
        // GetAsyncKeyState reads physical buttons: honour "swap primary and secondary buttons"
        let vk = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        let down = (GetAsyncKeyState(i32::from(vk.0)) as u16 & 0x8000) != 0;
        let mut c = pt;
        let _ = ScreenToClient(wall, &mut c);
        Some((
            label,
            PointerPayload {
                x: c.x,
                y: c.y,
                inside: true,
                down,
            },
        ))
    }
}

unsafe fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) } as usize;
    String::from_utf16_lossy(&buf[..n])
}

/// The icon list view, its DefView parent, or the Progman / WorkerW backdrop.
unsafe fn is_desktop_layer(hwnd: HWND) -> bool {
    unsafe {
        match class_of(hwnd).as_str() {
            "SysListView32" => GetParent(hwnd)
                .ok()
                .is_some_and(|p| class_of(p) == "SHELLDLL_DefView"),
            "SHELLDLL_DefView" | "Progman" | "WorkerW" => true,
            _ => false,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Attaching below the icons
// ---------------------------------------------------------------------------------------------

unsafe fn attach(hwnd: HWND, mon: &RECT) -> Option<(Mode, HWND)> {
    unsafe {
        let progman = FindWindowW(w!("Progman"), None).ok()?;
        // Ask Progman to create the WorkerW wallpaper layer (undocumented but stable since Win 8).
        let _ = SendMessageTimeoutW(
            progman,
            0x052C,
            WPARAM(0xD),
            LPARAM(1),
            SMTO_NORMAL,
            1000,
            None,
        );

        let defview_in_progman =
            FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None).ok();
        let (mode, parent) = if defview_in_progman.is_some() {
            (Mode::RaisedDesktop, progman)
        } else {
            (Mode::WorkerW, find_classic_worker()?)
        };

        make_child(hwnd, mode == Mode::RaisedDesktop);
        SetParent(hwnd, Some(parent)).ok()?;
        place(hwnd, parent, mon);
        keep_z_order(hwnd, mode, parent, None, &[]);
        Some((mode, parent))
    }
}

/// Classic layout: the top-level WorkerW right after the one hosting `SHELLDLL_DefView`.
unsafe fn find_classic_worker() -> Option<HWND> {
    unsafe extern "system" fn find(top: HWND, out: LPARAM) -> BOOL {
        unsafe {
            if FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), None).is_ok()
                && let Ok(worker) = FindWindowExW(None, Some(top), w!("WorkerW"), None)
            {
                *(out.0 as *mut HWND) = worker;
                return BOOL(0);
            }
            BOOL(1)
        }
    }
    let mut worker = HWND::default();
    unsafe {
        let _ = EnumWindows(Some(find), LPARAM(&mut worker as *mut HWND as isize));
    }
    (!worker.is_invalid()).then_some(worker)
}

unsafe fn make_child(hwnd: HWND, layered: bool) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let style = (style & !(WS_POPUP.0 | WS_CAPTION.0 | WS_THICKFRAME.0)) | WS_CHILD.0;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style as isize);

        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        ex = (ex & !WS_EX_APPWINDOW.0) | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0;
        if layered {
            ex |= WS_EX_LAYERED.0;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
        if layered {
            let _ = SetLayeredWindowAttributes(hwnd, Default::default(), 255, LWA_ALPHA);
        }
    }
}
/// Covers one monitor. Coordinates are in the parent's client space.
unsafe fn place(hwnd: HWND, parent: HWND, mon: &RECT) {
    unsafe {
        let mut pts = [POINT {
            x: mon.left,
            y: mon.top,
        }];
        MapWindowPoints(None, Some(parent), &mut pts);
        let _ = SetWindowPos(
            hwnd,
            None,
            pts[0].x,
            pts[0].y,
            mon.right - mon.left,
            mon.bottom - mon.top,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

/// Raised desktop: we must stay directly below `SHELLDLL_DefView`, above the system wallpaper.
/// With several monitors the windows form a chain under DefView (`after` = the previous one), and
/// nothing is moved when the order is already right: re-ordering every poll makes WebView2
/// windows flicker.
unsafe fn keep_z_order(hwnd: HWND, mode: Mode, parent: HWND, after: Option<HWND>, ours: &[HWND]) {
    unsafe {
        let flags = SWP_NOACTIVATE
            | windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
            | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE;
        match mode {
            Mode::RaisedDesktop => {
                let target = match after {
                    Some(prev) => prev,
                    None => match FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None) {
                        Ok(d) => d,
                        Err(_) => return,
                    },
                };
                if GetWindow(target, GW_HWNDNEXT).ok() != Some(hwnd) {
                    let _ = SetWindowPos(hwnd, Some(target), 0, 0, 0, 0, flags);
                }
            }
            Mode::WorkerW => {
                // At the bottom already, or only our other wallpapers below: leave it.
                if let Ok(below) = GetWindow(hwnd, GW_HWNDNEXT)
                    && !ours.contains(&below)
                {
                    let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, flags);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Icons via the Shell API
// ---------------------------------------------------------------------------------------------

/// `IShellWindows::FindWindowSW(CSIDL_DESKTOP)` → top-level browser → active view → `IFolderView`.
/// See "Manipulating the positions of desktop icons" (The Old New Thing, 2013).
unsafe fn desktop_folder_view() -> windows::core::Result<IFolderView> {
    unsafe {
        let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)?;
        let loc = VARIANT::from(0i32); // CSIDL_DESKTOP
        let empty = VARIANT::default();
        let mut hwnd = 0i32;
        let disp = windows.FindWindowSW(&loc, &empty, SWC_DESKTOP, &mut hwnd, SWFO_NEEDDISPATCH)?;
        let provider: IServiceProvider = disp.cast()?;
        let browser: IShellBrowser = provider.QueryService(&SID_STopLevelBrowser)?;
        let view = browser.QueryActiveShellView()?;
        view.cast()
    }
}
/// Every desktop icon, in the icon list view's client space.
struct IconLayout {
    visible: bool,
    spacing: POINT,
    list: Option<HWND>,
    points: Vec<POINT>,
}

unsafe fn read_icon_layout(view: &IFolderView) -> windows::core::Result<IconLayout> {
    unsafe {
        let mut spacing = POINT::default();
        view.GetSpacing(&mut spacing)?;

        let list = desktop_list_view();
        let visible = list.is_some_and(|l| IsWindowVisible(l).as_bool());

        let mut points: Vec<POINT> = Vec::new();
        let items: windows::Win32::UI::Shell::IEnumIDList = view.Items(SVGIO_ALLVIEW)?;
        loop {
            let mut pidl = [std::ptr::null_mut::<ITEMIDLIST>(); 1];
            let mut fetched = 0u32;
            if items.Next(&mut pidl, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            let pt = view.GetItemPosition(pidl[0]);
            CoTaskMemFree(Some(pidl[0] as *const c_void));
            points.push(pt?);
        }
        Ok(IconLayout {
            visible,
            spacing,
            list,
            points,
        })
    }
}

/// The icons that fall on one wallpaper window, in its client space.
unsafe fn icons_for(layout: &IconLayout, wallpaper: HWND) -> IconsPayload {
    unsafe {
        let mut points = layout.points.clone();
        if let Some(list) = layout.list {
            MapWindowPoints(Some(list), Some(wallpaper), &mut points);
        }
        let mut rect = RECT::default();
        let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(wallpaper, &mut rect);
        let surface = Size {
            w: rect.right - rect.left,
            h: rect.bottom - rect.top,
        };
        let (w, h) = (layout.spacing.x.max(1), layout.spacing.y.max(1));
        let mut icons: Vec<PhysicalRect> = points
            .into_iter()
            .map(|p| PhysicalRect {
                x: p.x,
                y: p.y,
                w,
                h,
            })
            // An icon belongs to the monitor that holds its centre.
            .filter(|r| {
                let (cx, cy) = (r.x + r.w / 2, r.y + r.h / 2);
                cx >= 0 && cy >= 0 && cx < surface.w && cy < surface.h
            })
            .collect();
        icons.sort_by_key(|r| (r.x, r.y));
        IconsPayload {
            visible: layout.visible,
            surface,
            icons,
        }
    }
}

unsafe fn desktop_list_view() -> Option<HWND> {
    unsafe {
        let progman = FindWindowW(w!("Progman"), None).ok()?;
        let defview = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None)
            .ok()
            .or_else(|| {
                // Classic layout: DefView lives in a top-level WorkerW.
                let mut found = None;
                let mut w = FindWindowExW(None, None, w!("WorkerW"), None).ok();
                while let Some(top) = w {
                    if let Ok(d) = FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), None) {
                        found = Some(d);
                        break;
                    }
                    w = FindWindowExW(None, Some(top), w!("WorkerW"), None).ok();
                }
                found
            })?;
        FindWindowExW(Some(defview), None, w!("SysListView32"), None).ok()
    }
}

// ---------------------------------------------------------------------------------------------
// Full-screen detection
// ---------------------------------------------------------------------------------------------
/// Which monitor a full-screen or maximized window covers right now.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Cover {
    None,
    All,
    /// The monitor rect (virtual-screen space).
    Monitor(RECT),
}

unsafe fn covered_monitor() -> Cover {
    unsafe {
        // Official signal: games, presentations and "busy" full-screen apps.
        let busy = SHQueryUserNotificationState().ok();
        if busy == Some(QUNS_PRESENTATION_MODE) {
            return Cover::All;
        }
        let busy = busy.is_some_and(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_BUSY);
        let fallback = if busy { Cover::All } else { Cover::None };

        let fg = GetForegroundWindow();
        if fg.is_invalid() || !IsWindowVisible(fg).as_bool() {
            return fallback;
        }
        let class = class_of(fg);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ) {
            return fallback;
        }
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(fg, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4).is_ok()
            && cloaked != 0
        {
            return fallback;
        }
        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONULL);
        if mon.is_invalid() {
            return fallback;
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(mon, &mut info).as_bool() {
            return fallback;
        }
        let m = info.rcMonitor;
        // A full-screen game or app covers the monitor it is on, not the others.
        if busy || IsZoomed(fg).as_bool() {
            return Cover::Monitor(m);
        }
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return Cover::None;
        }
        if r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom {
            Cover::Monitor(m)
        } else {
            Cover::None
        }
    }
}
