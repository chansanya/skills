use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::RunEvent;

fn is_server_alive() -> bool {
    if let Ok(addr) = "127.0.0.1:3001".parse() {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return true;
        }
    }
    false
}

fn start_backend_server() -> Option<Child> {
    if is_server_alive() {
        eprintln!("[server] Port 3001 is already listening, reusing existing server.");
        return None;
    }

    let current_exe = std::env::current_exe().ok()?;
    let exe_dir = current_exe.parent()?;

    let names = [
        "skills-server.exe",
        "skills-server-x86_64-pc-windows-msvc.exe",
        "binaries/skills-server.exe",
        "binaries/skills-server-x86_64-pc-windows-msvc.exe",
        "skills-server",
        "binaries/skills-server",
    ];

    let mut server_bin = None;
    for name in &names {
        let p = exe_dir.join(name);
        if p.is_file() {
            server_bin = Some(p);
            break;
        }
    }

    let bin = server_bin?;
    eprintln!("[server] Launching backend server binary at {:?}", bin);

    let mut cmd = Command::new(&bin);
    cmd.current_dir(exe_dir);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW (0x08000000) prevents console popup
        cmd.creation_flags(0x08000000);
    }

    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[server] Successfully spawned background server PID: {}", child.id());
            Some(child)
        }
        Err(e) => {
            eprintln!("[server] Failed to spawn server binary: {}", e);
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_holder = Arc::new(Mutex::new(None));
    let server_holder_clone = server_holder.clone();

    let app = tauri::Builder::default()
        .setup(move |_app| {
            if let Some(child) = start_backend_server() {
                if let Ok(mut lock) = server_holder_clone.lock() {
                    *lock = Some(child);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(move |_app_handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            if let Ok(mut lock) = server_holder.lock() {
                if let Some(mut child) = lock.take() {
                    eprintln!("[server] Terminating background server process...");
                    let _ = child.kill();
                }
            }
        }
    });
}
