use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_push);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<Push<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin("tr.com.bkthukuk.push", "PushPlugin")?;
  #[cfg(target_os = "ios")]
  let handle = api.register_ios_plugin(init_plugin_push)?;
  Ok(Push(handle))
}

/// Access to the push APIs.
pub struct Push<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Push<R> {
  pub fn get_token(&self) -> crate::Result<TokenResponse> {
    self
      .0
      .run_mobile_plugin("getToken", serde_json::json!({}))
      .map_err(Into::into)
  }

  pub fn get_pending_navigation(&self) -> crate::Result<NavigationResponse> {
    self
      .0
      .run_mobile_plugin("getPendingNavigation", serde_json::json!({}))
      .map_err(Into::into)
  }

  pub fn get_permission_state(&self) -> crate::Result<PermissionResponse> {
    self.0.run_mobile_plugin("getPermissionState", serde_json::json!({})).map_err(Into::into)
  }

  pub fn request_permission(&self) -> crate::Result<serde_json::Value> {
    self.0.run_mobile_plugin("requestPermissions", serde_json::json!({})).map_err(Into::into)
  }
}
