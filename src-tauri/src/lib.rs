#[cfg(target_os = "windows")]
fn windows_logon_session_id() -> Result<String, String> {
    use std::{ffi::c_void, mem::size_of};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenStatistics, TOKEN_QUERY, TOKEN_STATISTICS};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token: HANDLE = std::ptr::null_mut();
    let opened = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if opened == 0 {
        return Err(format!(
            "Windows erişim belirteci açılamadı: {}",
            std::io::Error::last_os_error()
        ));
    }

    let mut statistics: TOKEN_STATISTICS = unsafe { std::mem::zeroed() };
    let mut returned_length = 0_u32;
    let read = unsafe {
        GetTokenInformation(
            token,
            TokenStatistics,
            &mut statistics as *mut TOKEN_STATISTICS as *mut c_void,
            size_of::<TOKEN_STATISTICS>() as u32,
            &mut returned_length,
        )
    };
    unsafe { CloseHandle(token) };

    if read == 0 {
        return Err(format!(
            "Windows oturum istatistikleri okunamadı: {}",
            std::io::Error::last_os_error()
        ));
    }

    Ok(format!(
        "{:08x}:{:08x}",
        statistics.AuthenticationId.HighPart as u32,
        statistics.AuthenticationId.LowPart
    ))
}

#[tauri::command]
fn get_windows_logon_session_id() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        windows_logon_session_id()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Windows oturum kimliği bu platformda kullanılamaz.".to_string())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    #[test]
    fn current_windows_logon_session_id_is_available() {
        let session_id = super::windows_logon_session_id()
            .expect("Windows logon session ID should be readable");
        let parts: Vec<&str> = session_id.split(':').collect();
        assert_eq!(parts.len(), 2);
        assert!(parts.iter().all(|part| part.len() == 8));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_push::init())
        .invoke_handler(tauri::generate_handler![get_windows_logon_session_id])
        .run(tauri::generate_context!())
        .expect("BKT Hukuk masaüstü uygulaması başlatılamadı");
}
