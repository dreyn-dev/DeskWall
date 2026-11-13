//! The Windows user's languages, for the "System" UI language.

use crate::protocol::Locale;

/// User languages, most preferred first (BCP 47 tags such as `ru-RU`).
///
/// The order from Settings → Time & language → Language comes first. The display language
/// follows: it can differ when the top language has no installed language pack.
pub fn system_locales() -> Vec<String> {
    let mut out = preferred_languages();
    for l in sys_locale::get_locales() {
        if !out.iter().any(|o| o.eq_ignore_ascii_case(&l)) {
            out.push(l);
        }
    }
    out
}

/// Russian has no manual choice: it is used only through "System" on a Russian-first Windows.
pub fn wants_russian(pref: Locale) -> bool {
    pref == Locale::Auto && is_russian(&system_locales())
}

fn is_russian(locales: &[String]) -> bool {
    locales
        .first()
        .is_some_and(|l| l.to_ascii_lowercase().starts_with("ru"))
}

#[cfg(windows)]
fn preferred_languages() -> Vec<String> {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_MULTI_SZ, RegGetValueW};
    use windows::core::w;

    let key = w!("Control Panel\\International\\User Profile");
    let value = w!("Languages");
    let mut size: u32 = 0;
    // SAFETY: size query with no buffer, then a read into a buffer of the reported size.
    let buf = unsafe {
        if RegGetValueW(
            HKEY_CURRENT_USER,
            key,
            value,
            RRF_RT_REG_MULTI_SZ,
            None,
            None,
            Some(&mut size),
        )
        .is_err()
        {
            return Vec::new();
        }
        let mut buf = vec![0u16; (size as usize).div_ceil(2)];
        if RegGetValueW(
            HKEY_CURRENT_USER,
            key,
            value,
            RRF_RT_REG_MULTI_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut size),
        )
        .is_err()
        {
            return Vec::new();
        }
        buf.truncate(size as usize / 2);
        buf
    };
    buf.split(|&c| c == 0)
        .filter(|s| !s.is_empty())
        .map(String::from_utf16_lossy)
        .collect()
}

#[cfg(not(windows))]
fn preferred_languages() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(l: &[&str]) -> Vec<String> {
        l.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn russian_only_when_first() {
        assert!(is_russian(&v(&["ru", "en-US"])));
        assert!(is_russian(&v(&["RU-ru"])));
        assert!(!is_russian(&v(&["en-US", "ru-RU"])));
        assert!(!is_russian(&[]));
    }
}
