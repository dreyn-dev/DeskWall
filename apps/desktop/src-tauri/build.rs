fn main() {
    // Custom manifest: the 24H2+ wallpaper mode makes our window a layered *child* of Progman,
    // which Windows only allows for apps that declare Windows 8+ compatibility.
    let attrs = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(attrs))
        .expect("failed to run tauri-build");
}
