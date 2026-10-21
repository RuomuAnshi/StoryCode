//! Key-free public-web research. Never attach model credentials or project data.
use crate::error::{AppError, AppResult};
use futures_util::StreamExt;
use reqwest::Url;
use scraper::{Html, Selector};
use serde::Serialize;
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};
use tauri_plugin_opener::OpenerExt;

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_unspecified()
                || a == 0
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0)
                || (a == 192 && b == 2)
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Global unicast only; reject documentation, transition and embedded IPv4 ranges.
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
        }
    }
}
fn public_url(value: &str) -> AppResult<Url> {
    let mut url = Url::parse(value).map_err(|_| AppError::invalid("无效网址"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port_or_known_default(), Some(80 | 443))
    {
        return Err(AppError::invalid(
            "只支持无凭据、标准端口的公开 HTTP(S) 网页",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::invalid("网址缺少主机"))?;
    let plain_host = host.trim_matches(['[', ']']);
    if let Ok(ip) = plain_host.parse::<IpAddr>() {
        if !public_ip(ip) {
            return Err(AppError::invalid("不允许访问本机、内网或保留地址"));
        }
    } else if !host.contains('.')
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
    {
        return Err(AppError::invalid("只允许公开域名"));
    }
    url.set_fragment(None);
    Ok(url)
}
async fn download_inner(value: &str) -> AppResult<(String, String, String)> {
    let mut url = public_url(value)?;
    for _ in 0..5 {
        let host = url
            .host_str()
            .ok_or_else(|| AppError::invalid("缺少主机"))?
            .trim_matches(['[', ']'])
            .to_owned();
        let port = url.port_or_known_default().unwrap_or(443);
        let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|_| AppError::provider("网页域名解析失败"))?
            .collect();
        if addresses.is_empty() || addresses.iter().any(|addr| !public_ip(addr.ip())) {
            return Err(AppError::invalid("网址解析到非公开地址，已阻止请求"));
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(8))
            .user_agent("StoryCode/0.1 (public web research)")
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|_| AppError::internal("创建网页客户端失败"))?;
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|_| AppError::provider("网页连接失败或超时"))?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| AppError::provider("网页重定向无效"))?;
            url = public_url(
                url.join(location)
                    .map_err(|_| AppError::provider("网页重定向无效"))?
                    .as_str(),
            )?;
            continue;
        }
        if !response.status().is_success() {
            return Err(AppError::provider(format!(
                "网页服务返回 HTTP {}",
                response.status().as_u16()
            )));
        }
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !(mime.starts_with("text/html")
            || mime.starts_with("application/xhtml+xml")
            || mime.starts_with("text/plain"))
        {
            return Err(AppError::invalid(
                "仅支持 HTML / 纯文本网页，暂不支持 PDF 或下载文件",
            ));
        }
        const MAX_BYTES: usize = 1_000_000;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BYTES as u64)
        {
            return Err(AppError::provider("网页超过读取大小上限"));
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| AppError::provider("网页读取中断"))?;
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(AppError::provider("网页超过读取大小上限"));
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok((
            url.to_string(),
            String::from_utf8_lossy(&bytes).into_owned(),
            mime,
        ));
    }
    Err(AppError::provider("网页重定向次数过多"))
}
async fn download(url: &str) -> AppResult<(String, String, String)> {
    tokio::time::timeout(Duration::from_secs(20), download_inner(url))
        .await
        .map_err(|_| AppError::provider("网页请求超时"))?
}
fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static selector")
}
fn clean(value: &str, limit: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}
#[derive(Serialize)]
pub struct SearchItem {
    title: String,
    url: String,
    snippet: String,
}
#[derive(Serialize)]
pub struct SearchResults {
    results: Vec<SearchItem>,
}
fn parse_search(html: &str, limit: usize) -> AppResult<SearchResults> {
    let document = Html::parse_document(html);
    if html.contains("anomaly-modal") || html.contains("anomaly.js") {
        return Err(AppError::provider("搜索服务要求验证码，请稍后重试"));
    }
    let mut results: Vec<SearchItem> = Vec::new();
    for result in document.select(&selector(".result")) {
        let Some(link) = result.select(&selector(".result__a")).next() else {
            continue;
        };
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let href = if href.starts_with("//") {
            format!("https:{href}")
        } else {
            href.to_owned()
        };
        let Ok(mut url) = Url::parse(&href) else {
            continue;
        };
        if url
            .host_str()
            .is_some_and(|host| host == "duckduckgo.com" || host.ends_with(".duckduckgo.com"))
        {
            let Some(target) = url
                .query_pairs()
                .find(|(key, _)| key == "uddg")
                .map(|(_, value)| value.into_owned())
            else {
                continue;
            };
            let Ok(target) = public_url(&target) else {
                continue;
            };
            url = target;
        }
        let Ok(url) = public_url(url.as_str()) else {
            continue;
        };
        if results.iter().any(|item| item.url == url.as_str()) {
            continue;
        }
        let title = clean(&link.text().collect::<Vec<_>>().join(" "), 500);
        if title.is_empty() {
            continue;
        }
        let snippet = result
            .select(&selector(".result__snippet"))
            .next()
            .map(|el| clean(&el.text().collect::<Vec<_>>().join(" "), 1500))
            .unwrap_or_default();
        results.push(SearchItem {
            title,
            url: url.to_string(),
            snippet,
        });
        if results.len() >= limit {
            break;
        }
    }
    if results.is_empty() && !html.contains("no-results") {
        return Err(AppError::provider(
            "搜索服务返回了无法解析的页面，请稍后重试",
        ));
    }
    Ok(SearchResults { results })
}
#[tauri::command]
pub async fn web_search(query: String, limit: usize) -> AppResult<SearchResults> {
    if query.trim().is_empty() || query.chars().count() > 300 || !(1..=5).contains(&limit) {
        return Err(AppError::invalid("查询需为 1–300 字符，结果数为 1–5"));
    }
    let mut url = Url::parse("https://html.duckduckgo.com/html/").unwrap();
    url.query_pairs_mut().append_pair("q", query.trim());
    let (_, html, _) = download(url.as_str()).await?;
    parse_search(&html, limit)
}
#[derive(Serialize)]
pub struct WebPage {
    title: String,
    url: String,
    text: String,
    truncated: bool,
}
fn parse_page(url: String, body: &str, mime: &str) -> AppResult<WebPage> {
    let (title, text) = if mime.starts_with("text/plain") {
        (String::new(), body.to_owned())
    } else {
        let doc = Html::parse_document(body);
        let title = doc
            .select(&selector("title"))
            .next()
            .map(|el| clean(&el.text().collect::<Vec<_>>().join(" "), 500))
            .unwrap_or_default();
        let root = doc
            .select(&selector("article, main"))
            .next()
            .unwrap_or_else(|| doc.root_element());
        let mut parts = Vec::new();
        for node in root.descendants() {
            if let Some(text) = node.value().as_text() {
                if node
                    .ancestors()
                    .filter_map(|parent| parent.value().as_element())
                    .any(|el| {
                        matches!(
                            el.name(),
                            "script"
                                | "style"
                                | "noscript"
                                | "template"
                                | "head"
                                | "nav"
                                | "footer"
                        )
                    })
                {
                    continue;
                }
                parts.push(text.to_string());
            }
        }
        (title, parts.join(" "))
    };
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(AppError::provider(
            "网页没有可读取的正文，可能需要登录或运行脚本",
        ));
    }
    let truncated = text.chars().count() > 12000;
    Ok(WebPage {
        title,
        url,
        text: text.chars().take(12000).collect(),
        truncated,
    })
}
#[tauri::command]
pub async fn web_fetch(url: String) -> AppResult<WebPage> {
    let (url, body, mime) = download(&url).await?;
    parse_page(url, &body, &mime)
}
#[tauri::command]
pub fn open_web_url(app: tauri::AppHandle, url: String) -> AppResult<()> {
    let url = public_url(&url)?;
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|_| AppError::internal("无法打开来源链接"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_private_and_reserved_destinations() {
        for url in [
            "file:///etc/passwd",
            "http://localhost",
            "http://127.1",
            "http://2130706433",
            "http://[::1]",
            "http://[::ffff:127.0.0.1]",
            "http://169.254.169.254",
            "http://10.0.0.1",
            "http://100.64.0.1",
            "http://192.168.1.1",
            "http://224.0.0.1",
            "https://user:pass@example.com",
            "http://example.com:8080",
        ] {
            assert!(public_url(url).is_err(), "{url}");
        }
        assert!(public_url("https://example.com/path").is_ok());
        assert!(!public_ip("2001:db8::1".parse().unwrap()));
    }
    #[test]
    fn parses_search_results_and_rejects_challenges() {
        let html = r#"<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsource">示例 &amp; 来源</a><div class="result__snippet">公开摘要</div></div>"#;
        let result = parse_search(html, 5).unwrap();
        assert_eq!(result.results[0].url, "https://example.com/source");
        assert_eq!(result.results[0].title, "示例 & 来源");
        assert!(parse_search("<div class='anomaly-modal'>challenge</div>", 5).is_err());
        assert!(parse_search("unexpected response", 5).is_err());
    }
    #[test]
    fn extracts_text_without_scripts_and_marks_truncation() {
        let page = parse_page("https://example.com".into(), "<title>来源</title><main><p>正文资料</p><script>恶意脚本</script><style>隐藏样式</style></main>", "text/html").unwrap();
        assert_eq!(page.text, "正文资料");
        assert_eq!(page.title, "来源");
        let page = parse_page(
            "https://example.com".into(),
            &"字".repeat(13000),
            "text/plain",
        )
        .unwrap();
        assert_eq!(page.text.chars().count(), 12000);
        assert!(page.truncated);
    }
}
