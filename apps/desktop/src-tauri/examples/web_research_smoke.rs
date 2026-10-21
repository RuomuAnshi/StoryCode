//! Manual, free public-network smoke check. Not part of the offline test suite.
use storycode_lib::web_research::{web_fetch, web_search};
fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result: Result<(), Box<dyn std::error::Error>> = runtime.block_on(async {
        let search = serde_json::to_value(
            web_search("Rust programming language official documentation".into(), 3).await?,
        )?;
        println!(
            "search_results={}",
            search["results"].as_array().map_or(0, Vec::len)
        );
        if let Some(url) = search["results"][0]["url"].as_str() {
            println!("first_source={url}");
        }
        let page = serde_json::to_value(web_fetch("https://example.com/".into()).await?)?;
        println!(
            "page_title={}; text_chars={}; truncated={}",
            page["title"],
            page["text"]
                .as_str()
                .map_or(0, |value| value.chars().count()),
            page["truncated"]
        );
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("Manual web check failed: {error}");
        std::process::exit(1);
    }
}
