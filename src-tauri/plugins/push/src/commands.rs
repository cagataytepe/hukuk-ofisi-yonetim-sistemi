use tauri::{AppHandle, command, Runtime};

use crate::models::*;
use crate::Result;
use crate::PushExt;

#[command]
pub(crate) async fn get_token<R: Runtime>(app: AppHandle<R>) -> Result<TokenResponse> {
    app.push().get_token()
}

#[command]
pub(crate) async fn get_pending_navigation<R: Runtime>(app: AppHandle<R>) -> Result<NavigationResponse> {
    app.push().get_pending_navigation()
}

#[command]
pub(crate) async fn get_permission_state<R: Runtime>(app: AppHandle<R>) -> Result<PermissionResponse> {
    app.push().get_permission_state()
}

#[command]
pub(crate) async fn request_permission<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.push().request_permission()
}
