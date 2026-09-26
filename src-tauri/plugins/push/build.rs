const COMMANDS: &[&str] = &["get_token", "get_pending_navigation", "get_permission_state", "request_permission"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .ios_path("ios")
    .build();
}
