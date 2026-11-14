//! Windows desktop integration.
//!
//! * Attaches the wallpaper webview window *below* the desktop icon layer (Progman / WorkerW).
//! * Reads icon positions with the documented Shell API (`IShellWindows` → `IFolderView`),
//!   never by reading another process's memory.
//! * Detects full-screen apps (`SHQueryUserNotificationState` + foreground window checks).
//!
//! Everything COM-related runs on one dedicated STA thread that polls a few times per second.

use std::ffi::c_void;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY, MONITORINFO, MapWindowPoints,
    MonitorFromPoint, MonitorFromWindow, ScreenToClient,
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
    EnumWindows, FindWindowExW, FindWindowW, GWL_EXSTYLE, GWL_STYLE, GetClassNameW, GetCursorPos,
    GetForegroundWindow, GetParent, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect,
    HWND_BOTTOM, IsWindow, IsWindowVisible, IsZoomed, LWA_ALPHA, SM_SWAPBUTTON, SMTO_NORMAL,
    SPI_GETDESKWALLPAPER, SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, SendMessageTimeoutW, SetLayeredWindowAttributes,
    SetParent, SetWindowLongPtrW, SetWindowPos, SystemParametersInfoW, WS_CAPTION, WS_CHILD,
    WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP, WS_THICKFRAME,
    WindowFromPoint,
};
use windows::core::{BOOL, Interface, w};

use crate::protocol::{EVENT_POINTER, IconsPayload, PhysicalRect, PointerPayload, Size, WALLPAPER};
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
static WALLPAPER_HWND: AtomicIsize = AtomicIsize::new(0);

fn hwnd_of(window: &WebviewWindow) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0))
}

pub fn start(app: AppHandle, state: Arc<HostState>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(WALLPAPER) else {
        log::error!("wallpaper window missing");
        return Ok(());
    };
    let Some(hwnd) = hwnd_of(&window) else {
        log::error!("wallpaper window has no HWND");
        return Ok(());
    };
    WALLPAPER_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
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
    if let Some(w) = app.get_webview_window(WALLPAPER) {
        let _ = w.hide();
        if let Some(hwnd) = hwnd_of(&w) {
            unsafe {
                let _ = SetParent(hwnd, None);
            }
        }
    }
    refresh_system_wallpaper();
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
// Watcher thread
// ---------------------------------------------------------------------------------------------

fn watcher(app: AppHandle, state: Arc<HostState>) {
    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
            log::error!("CoInitializeEx failed; icon tracking disabled");
        }
    }
    let hwnd = HWND(WALLPAPER_HWND.load(Ordering::SeqCst) as *mut c_void);
    let mut attached: Option<(Mode, HWND)> = None;
    let mut shell: Option<IFolderView> = None;

    while RUNNING.load(Ordering::SeqCst) {
        // (Re)attach when Explorer restarted or replaced our parent.
        let healthy = attached.is_some_and(|(_, parent)| unsafe {
            IsWindow(Some(parent)).as_bool() && GetParent(hwnd).ok() == Some(parent)
        });
        if !healthy {
            attached = unsafe { attach(hwnd) };
            shell = None;
            match attached {
                Some((mode, _)) => log::info!("wallpaper attached: {mode:?}"),
                None => log::warn!("could not attach wallpaper; retrying"),
            }
        }
        if let Some((mode, parent)) = attached {
            unsafe { keep_z_order(hwnd, mode, parent) };
        }

        // Icons.
        if shell.is_none() {
            shell = unsafe { desktop_folder_view() }
                .inspect_err(|e| log::debug!("folder view: {e}"))
                .ok();
        }
        if let Some(view) = &shell {
            match unsafe { read_icons(view, hwnd) } {
                Ok(payload) => state.publish_icons(&app, Some(payload), false),
                Err(e) => {
                    log::debug!("read icons failed: {e}");
                    shell = None;
                }
            }
        }

        // Full-screen / presentation detection.
        let covered = unsafe { foreground_covers_wallpaper(hwnd) };
        state.covered.store(covered, Ordering::Relaxed);
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
/// position and the left button state to the wallpaper page. Nothing is intercepted, so icon
/// clicks, drag-select and the desktop menu work as before.
fn pointer_watcher(app: AppHandle) {
    let wallpaper = HWND(WALLPAPER_HWND.load(Ordering::SeqCst) as *mut c_void);
    let mut last = PointerPayload {
        x: 0,
        y: 0,
        inside: false,
        down: false,
    };
    while RUNNING.load(Ordering::SeqCst) {
        let now = unsafe { read_pointer(wallpaper) };
        if now != last && (now.inside || last.inside) {
            if let Err(err) = app.emit_to(WALLPAPER, EVENT_POINTER, now) {
                log::debug!("emit pointer failed: {err}");
            }
            last = now;
        }
        // ~60 Hz while over the desktop, a relaxed check otherwise
        thread::sleep(Duration::from_millis(if now.inside { 16 } else { 90 }));
    }
}

unsafe fn read_pointer(wallpaper: HWND) -> PointerPayload {
    unsafe {
        let mut pt = POINT::default();
        let outside = PointerPayload {
            x: 0,
            y: 0,
            inside: false,
            down: false,
        };
        if GetCursorPos(&mut pt).is_err() {
            return outside;
        }
        let hit = WindowFromPoint(pt);
        let inside = !hit.is_invalid() && (hit == wallpaper || is_desktop_layer(hit));
        if !inside {
            return outside;
        }
        // GetAsyncKeyState reads physical buttons: honour "swap primary and secondary buttons"
        let vk = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        let down = (GetAsyncKeyState(i32::from(vk.0)) as u16 & 0x8000) != 0;
        let mut c = pt;
        let _ = ScreenToClient(wallpaper, &mut c);
        PointerPayload {
            x: c.x,
            y: c.y,
            inside: true,
            down,
        }
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

unsafe fn attach(hwnd: HWND) -> Option<(Mode, HWND)> {
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
        place(hwnd, parent);
        keep_z_order(hwnd, mode, parent);
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

/// Covers the primary monitor. Coordinates are in the parent's client space.
unsafe fn place(hwnd: HWND, parent: HWND) {
    unsafe {
        let mon = primary_monitor_rect();
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
unsafe fn keep_z_order(hwnd: HWND, mode: Mode, parent: HWND) {
    unsafe {
        let flags = SWP_NOACTIVATE
            | windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
            | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE;
        match mode {
            Mode::RaisedDesktop => {
                if let Ok(defview) = FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None)
                {
                    let _ = SetWindowPos(hwnd, Some(defview), 0, 0, 0, 0, flags);
                }
            }
            Mode::WorkerW => {
                let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, flags);
            }
        }
    }
}

fn primary_monitor_rect() -> RECT {
    unsafe {
        let mon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(mon, &mut info);
        info.rcMonitor
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

unsafe fn read_icons(view: &IFolderView, wallpaper: HWND) -> windows::core::Result<IconsPayload> {
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

        // Item positions are in the icon list-view's client space; map them into ours.
        if let Some(list) = list {
            MapWindowPoints(Some(list), Some(wallpaper), &mut points);
        }

        let mut rect = RECT::default();
        let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(wallpaper, &mut rect);
        let surface = Size {
            w: rect.right - rect.left,
            h: rect.bottom - rect.top,
        };
        let mut icons: Vec<PhysicalRect> = points
            .into_iter()
            .map(|p| PhysicalRect {
                x: p.x,
                y: p.y,
                w: spacing.x.max(1),
                h: spacing.y.max(1),
            })
            .filter(|r| r.x + r.w > 0 && r.y + r.h > 0 && r.x < surface.w && r.y < surface.h)
            .collect();
        icons.sort_by_key(|r| (r.x, r.y));
        Ok(IconsPayload {
            visible,
            surface,
            icons,
        })
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

unsafe fn foreground_covers_wallpaper(wallpaper: HWND) -> bool {
    unsafe {
        // Official signal first: games, presentations and "busy" full-screen apps.
        if let Ok(state) = SHQueryUserNotificationState()
            && (state == QUNS_RUNNING_D3D_FULL_SCREEN
                || state == QUNS_PRESENTATION_MODE
                || state == QUNS_BUSY)
        {
            return true;
        }

        let fg = GetForegroundWindow();
        if fg.is_invalid() || fg == wallpaper || !IsWindowVisible(fg).as_bool() {
            return false;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(fg, &mut class) as usize;
        let class = String::from_utf16_lossy(&class[..n]);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ) {
            return false;
        }
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(fg, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4).is_ok()
            && cloaked != 0
        {
            return false;
        }
        // Only windows on the wallpaper's (primary) monitor matter.
        let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        if MonitorFromWindow(fg, MONITOR_DEFAULTTONULL) != primary {
            return false;
        }
        if IsZoomed(fg).as_bool() {
            return true;
        }
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let m = primary_monitor_rect();
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}
