//! Window chrome for the frameless settings window: Windows 11 Snap Layouts on our own
//! "Maximize" button.
//!
//! Windows shows the Snap Layouts flyout when the top-level window answers `WM_NCHITTEST` with
//! `HTMAXBUTTON`. The web page can't do that: WebView2 draws in a child window of another
//! process, which answers every hit test itself. So a tiny, almost invisible child window of
//! ours sits over the button and answers `HTTRANSPARENT`; the same-thread windows below it pass
//! the test on, and the top-level window answers `HTMAXBUTTON`. Clicks then arrive as
//! non-client messages on the top-level window: we toggle maximize ourselves and tell the page
//! to draw hover / pressed states (`deskwall://caption`).

/// Event to the settings page: `{ "hover": bool, "pressed": bool }` for the maximize button.
pub const EVENT_CAPTION: &str = "deskwall://caption";

/// Caption button geometry in logical pixels (brand/DESIGN.md "Заголовок окна").
pub const CAPTION_HEIGHT: f64 = 40.0;
pub const BUTTON_WIDTH: f64 = 46.0;

/// The maximize button rectangle in client pixels: second button from the right.
pub fn max_button_rect(client_width: i32, scale: f64) -> (i32, i32, i32, i32) {
    let w = (BUTTON_WIDTH * scale).round() as i32;
    let h = (CAPTION_HEIGHT * scale).round() as i32;
    let right = client_width - w;
    (right - w, 0, right, h)
}

#[cfg(windows)]
pub use imp::install;

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) {}

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{ScreenToClient, ValidateRect};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        ReleaseCapture, SetCapture, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, EnumChildWindows, GA_ROOT, GetAncestor, GetClientRect,
        GetWindowThreadProcessId, HTMAXBUTTON, HTTRANSPARENT, HWND_TOP, IsZoomed, LWA_ALPHA,
        RegisterClassW, SW_MAXIMIZE, SW_RESTORE, SWP_NOACTIVATE, SWP_SHOWWINDOW,
        SetLayeredWindowAttributes, SetWindowPos, ShowWindow, WM_CAPTURECHANGED, WM_ERASEBKGND,
        WM_LBUTTONUP, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP,
        WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_PAINT, WM_SIZE, WNDCLASSW, WS_CHILD, WS_EX_LAYERED,
        WS_EX_NOACTIVATE, WS_VISIBLE,
    };
    use windows::core::w;

    use super::{EVENT_CAPTION, max_button_rect};
    use crate::protocol::SETTINGS;

    const ROOT_ID: usize = 0x4457_0001;
    const CHILD_ID: usize = 0x4457_0002;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static OVERLAY: AtomicIsize = AtomicIsize::new(0);
    static HOVER: AtomicBool = AtomicBool::new(false);
    static PRESSED: AtomicBool = AtomicBool::new(false);

    /// Installs (or refreshes) Snap Layouts support on the settings window. Safe to call again:
    /// WebView2 creates its child windows late, so this runs each time the window is shown.
    pub fn install(window: &tauri::WebviewWindow) {
        let _ = APP.set(window.app_handle().clone());
        let Ok(hwnd) = window.hwnd() else { return };
        let root = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || unsafe {
            let root = HWND(root as _);
            let ok = SetWindowSubclass(root, Some(root_proc), ROOT_ID, 0).as_bool();
            ensure_overlay(root);
            let thread = GetCurrentThreadId();
            let _ = EnumChildWindows(Some(root), Some(subclass_child), LPARAM(thread as isize));
            place_overlay(root);
            log::debug!(
                "snap layouts hook: subclass={ok}, overlay={:#x}, button={:?}",
                OVERLAY.load(Ordering::Relaxed),
                button(root)
            );
        });
    }

    unsafe extern "system" fn subclass_child(child: HWND, thread: LPARAM) -> windows::core::BOOL {
        unsafe {
            // Only windows of our UI thread can be subclassed (and can pass the hit test on).
            if GetWindowThreadProcessId(child, None) == thread.0 as u32
                && child.0 as isize != OVERLAY.load(Ordering::Relaxed)
            {
                let _ = SetWindowSubclass(child, Some(child_proc), CHILD_ID, 0);
            }
        }
        true.into()
    }

    fn scale(hwnd: HWND) -> f64 {
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 }
    }

    /// The maximize button in the root window's client coordinates.
    fn button(root: HWND) -> RECT {
        let mut client = RECT::default();
        unsafe {
            let _ = GetClientRect(root, &mut client);
        }
        let (left, top, right, bottom) = max_button_rect(client.right, scale(root));
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    fn hit(root: HWND, lparam: LPARAM) -> bool {
        let mut p = POINT {
            x: (lparam.0 & 0xffff) as i16 as i32,
            y: ((lparam.0 >> 16) & 0xffff) as i16 as i32,
        };
        unsafe {
            let _ = ScreenToClient(root, &mut p);
        }
        inside(&button(root), p)
    }

    fn emit() {
        if let Some(app) = APP.get() {
            let _ = app.emit_to(
                SETTINGS,
                EVENT_CAPTION,
                serde_json::json!({
                    "hover": HOVER.load(Ordering::Relaxed),
                    "pressed": PRESSED.load(Ordering::Relaxed),
                }),
            );
        }
    }

    fn set_hover(root: HWND, hover: bool) {
        if HOVER.swap(hover, Ordering::Relaxed) == hover {
            return;
        }
        if hover {
            let mut track = TRACKMOUSEEVENT {
                cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_LEAVE | TME_NONCLIENT,
                hwndTrack: root,
                dwHoverTime: 0,
            };
            unsafe {
                let _ = TrackMouseEvent(&mut track);
            }
        } else {
            PRESSED.store(false, Ordering::Relaxed);
        }
        emit();
    }

    unsafe extern "system" fn root_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        let is_max = wparam.0 == HTMAXBUTTON as usize;
        match msg {
            WM_NCHITTEST if hit(hwnd, lparam) => return LRESULT(HTMAXBUTTON as isize),
            WM_NCMOUSEMOVE => set_hover(hwnd, is_max),
            WM_NCMOUSELEAVE => set_hover(hwnd, false),
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK if is_max => {
                // Windows doesn't reliably send WM_NCLBUTTONUP once the button-down is not passed
                // to DefWindowProc (which would draw a classic caption button). So capture the
                // mouse and finish the click on the client-area WM_LBUTTONUP instead.
                PRESSED.store(true, Ordering::Relaxed);
                unsafe { SetCapture(hwnd) };
                emit();
                return LRESULT(0);
            }
            WM_LBUTTONUP if PRESSED.load(Ordering::Relaxed) => {
                let p = POINT {
                    x: (lparam.0 & 0xffff) as i16 as i32,
                    y: ((lparam.0 >> 16) & 0xffff) as i16 as i32,
                };
                finish_click(hwnd, inside(&button(hwnd), p));
                return LRESULT(0);
            }
            WM_NCLBUTTONUP if is_max && PRESSED.load(Ordering::Relaxed) => {
                finish_click(hwnd, true);
                return LRESULT(0);
            }
            WM_CAPTURECHANGED if PRESSED.load(Ordering::Relaxed) => {
                PRESSED.store(false, Ordering::Relaxed);
                emit();
            }
            WM_SIZE => {
                let r = unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };
                place_overlay(hwnd);
                return r;
            }
            _ => {}
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    fn inside(r: &RECT, p: POINT) -> bool {
        p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom
    }

    /// Ends a press on the maximize button: maximizes or restores when released over it.
    fn finish_click(root: HWND, released_inside: bool) {
        PRESSED.store(false, Ordering::Relaxed);
        unsafe {
            let _ = ReleaseCapture();
        }
        if released_inside {
            toggle_maximize(root);
        }
        emit();
    }

    pub(super) fn toggle_maximize(root: HWND) {
        unsafe {
            let cmd = if IsZoomed(root).as_bool() {
                SW_RESTORE
            } else {
                SW_MAXIMIZE
            };
            let _ = ShowWindow(root, cmd);
        }
    }

    /// Same-thread child windows (the webview host) pass the hit test over the button upward.
    unsafe extern "system" fn child_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_NCHITTEST {
            let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
            if hit(root, lparam) {
                return LRESULT(HTTRANSPARENT as isize);
            }
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    unsafe extern "system" fn overlay_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => unsafe {
                let _ = ValidateRect(Some(hwnd), None);
                LRESULT(0)
            },
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    fn ensure_overlay(root: HWND) {
        if OVERLAY.load(Ordering::Relaxed) != 0 {
            return;
        }
        unsafe {
            let Ok(module) = GetModuleHandleW(None) else {
                return;
            };
            let class = w!("DeskWallSnapOverlay");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(overlay_proc),
                hInstance: module.into(),
                lpszClassName: class,
                ..Default::default()
            };
            RegisterClassW(&wc);
            let r = button(root);
            if let Ok(overlay) = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_NOACTIVATE,
                class,
                w!(""),
                WS_CHILD | WS_VISIBLE,
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
                Some(root),
                None,
                Some(module.into()),
                None,
            ) {
                // Alpha 1/255: invisible, but still part of hit testing.
                let _ = SetLayeredWindowAttributes(
                    overlay,
                    windows::Win32::Foundation::COLORREF(0),
                    1,
                    LWA_ALPHA,
                );
                OVERLAY.store(overlay.0 as isize, Ordering::Relaxed);
            }
        }
    }

    fn place_overlay(root: HWND) {
        let overlay = OVERLAY.load(Ordering::Relaxed);
        if overlay == 0 {
            return;
        }
        let r = button(root);
        unsafe {
            let _ = SetWindowPos(
                HWND(overlay as _),
                Some(HWND_TOP),
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::max_button_rect;

    #[test]
    fn maximize_button_is_second_from_the_right() {
        assert_eq!(max_button_rect(1200, 1.0), (1108, 0, 1154, 40));
        assert_eq!(max_button_rect(2400, 2.0), (2216, 0, 2308, 80));
    }
}
