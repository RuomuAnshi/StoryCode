//! StoryCode desktop shell.
//!
//! Responsibilities, in order of importance:
//! 1. Keep the model API key inside the Rust process (never in the webview).
//! 2. Confine every filesystem operation to the open project directory.
//! 3. Expose small, typed commands to the React frontend.

pub mod error;
pub mod fs_commands;
pub mod model_proxy;
pub mod paths;
pub mod secrets;
pub mod state;
pub mod web_research;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            fs_commands::set_project_root,
            fs_commands::get_project_root,
            fs_commands::read_text_file,
            fs_commands::write_text_file,
            fs_commands::file_exists,
            fs_commands::stat_file,
            fs_commands::list_directory,
            fs_commands::create_directory,
            fs_commands::delete_file,
            fs_commands::rename_entry,
            fs_commands::create_project_directory,
            fs_commands::hash_file,
            fs_commands::read_many_files,
            secrets::set_api_key,
            secrets::delete_api_key,
            secrets::get_key_status,
            secrets::keyring_available,
            web_research::web_search,
            web_research::web_fetch,
            web_research::open_web_url,
            model_proxy::stream_chat,
            model_proxy::cancel_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running StoryCode");
}
