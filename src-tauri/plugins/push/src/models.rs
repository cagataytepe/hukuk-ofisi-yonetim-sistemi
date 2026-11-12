use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
  pub token: Option<String>,
  pub platform: Option<String>,
  pub environment: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationResponse {
  pub route: Option<String>,
  pub file_id: Option<String>,
  pub hearing_id: Option<String>,
  pub view: Option<String>,
  pub date: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
  pub granted: bool,
}
