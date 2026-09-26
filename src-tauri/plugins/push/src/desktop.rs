use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<Push<R>> {
  Ok(Push(app.clone()))
}

/// Access to the push APIs.
pub struct Push<R: Runtime>(AppHandle<R>);

impl<R: Runtime> Push<R> {
  pub fn get_token(&self) -> crate::Result<TokenResponse> {
    Ok(TokenResponse { token: None })
  }

  pub fn get_pending_navigation(&self) -> crate::Result<NavigationResponse> {
    Ok(NavigationResponse::default())
  }

  pub fn get_permission_state(&self) -> crate::Result<PermissionResponse> {
    Ok(PermissionResponse { granted: false })
  }

  pub fn request_permission(&self) -> crate::Result<serde_json::Value> {
    Ok(serde_json::json!({ "notifications": "denied" }))
  }
}
