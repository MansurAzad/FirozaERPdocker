use tauri_plugin_updater::UpdaterExt;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let updater = match handle.updater() {
                    Ok(updater) => updater,
                    Err(error) => {
                        eprintln!("Desktop updater initialization failed: {error}");
                        return;
                    }
                };

                match updater.check().await {
                    Ok(Some(update)) => {
                        eprintln!(
                            "Installing Firoza ERP update {} over {}",
                            update.version, update.current_version
                        );
                        if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
                            eprintln!("Desktop update installation failed: {error}");
                        }
                    }
                    Ok(None) => {}
                    Err(error) => eprintln!("Desktop update check failed: {error}"),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Firoza ERP");
}
