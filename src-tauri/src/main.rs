#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use claudegauge_lib::claude::hook_writer;
use claudegauge_lib::ipc::{
    get_config, get_live, install_hook, refresh_history, remove_hook, save_config,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

fn home_claude() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".claude")
}

fn home_codex() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".codex")
}

fn spawn_watchers(app: AppHandle) {
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = match RecommendedWatcher::new(tx, notify::Config::default()) {
            Ok(w) => w,
            Err(_) => return,
        };
        let claude_live_path = home_claude().join("claudegauge-live.json");
        if let Some(parent) = claude_live_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if !claude_live_path.exists() {
            let _ = std::fs::write(&claude_live_path, "{}");
        }
        let _ = watcher.watch(&claude_live_path, RecursiveMode::NonRecursive);

        let codex_sessions = home_codex().join("sessions");
        if codex_sessions.exists() {
            let _ = watcher.watch(&codex_sessions, RecursiveMode::Recursive);
        }

        while let Ok(_event) = rx.recv() {
            thread::sleep(Duration::from_millis(100));
            if let Ok(snap) = get_live() {
                update_tray_icon(&app, &snap);
                let _ = app.emit("live-update", snap);
            }
        }
    });
}

fn max_seven_day_percent(snap: &claudegauge_lib::ipc::LiveSnapshot) -> f64 {
    let claude_pct = snap
        .claude
        .as_ref()
        .and_then(|c| c.seven_day.as_ref())
        .map(|r| r.used_percent)
        .unwrap_or(0.0);
    let codex_pct = snap
        .codex
        .as_ref()
        .and_then(|c| c.seven_day.as_ref())
        .map(|r| r.used_percent)
        .unwrap_or(0.0);
    claude_pct.max(codex_pct)
}

fn update_tray_icon(app: &AppHandle, snap: &claudegauge_lib::ipc::LiveSnapshot) {
    let pct = max_seven_day_percent(snap);
    let icon_name = if pct < 70.0 {
        "tray-normal.png"
    } else if pct < 90.0 {
        "tray-warning.png"
    } else {
        "tray-danger.png"
    };
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(icon) = load_icon(icon_name) {
            let _ = tray.set_icon(Some(icon));
        }
    }
}

fn load_icon(name: &str) -> anyhow::Result<Image<'static>> {
    let path = std::env::current_exe()?
        .parent()
        .ok_or_else(|| anyhow::anyhow!("no parent of exe"))?
        .join("icons")
        .join(name);
    let img = Image::from_path(path.as_path())?;
    Ok(img)
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "展開視窗", true, None::<&str>)?;
    let refresh_i = MenuItem::with_id(app, "refresh", "重新掃描歷史", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &refresh_i, &quit_i])?;

    let default_icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("default-icon".into()))?
        .clone();

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(default_icon)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "refresh" => {
                let _ = app.emit("force-refresh", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            install_hook,
            remove_hook,
            get_live,
            refresh_history,
            get_config,
            save_config
        ])
        .setup(|app| {
            let _ = hook_writer::ensure_stop_hook(&home_claude());

            setup_tray(&app.handle())?;

            let cfg = claudegauge_lib::config::load();
            if let (Some(x), Some(y)) = (cfg.last_x, cfg.last_y) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }

            spawn_watchers(app.handle().clone());
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Moved(pos) = event {
                let mut cfg = claudegauge_lib::config::load();
                cfg.last_x = Some(pos.x);
                cfg.last_y = Some(pos.y);
                let _ = claudegauge_lib::config::save(&cfg);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
