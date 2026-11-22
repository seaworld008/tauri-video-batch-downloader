use anyhow::{anyhow, bail, Result};
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DashTrackKind {
    Video,
    Audio,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DashInitSegment {
    pub url: String,
    pub byte_range: Option<(u64, u64)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashSegment {
    pub index: usize,
    pub url: String,
    pub byte_range: Option<(u64, u64)>,
    pub init_segment: Option<DashInitSegment>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DashRepresentation {
    pub id: String,
    pub kind: DashTrackKind,
    pub bandwidth: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub mime_type: Option<String>,
    pub codecs: Option<String>,
    pub lang: Option<String>,
    pub init_segment: Option<DashInitSegment>,
    pub segments: Vec<DashSegment>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DashManifest {
    pub is_live: bool,
    pub duration_seconds: Option<f64>,
    pub representations: Vec<DashRepresentation>,
}

#[derive(Debug, Clone, Default)]
pub struct DashTrackSelection<'a> {
    pub video: Option<&'a DashRepresentation>,
    pub audio: Option<&'a DashRepresentation>,
}

#[derive(Debug, Clone, Default)]
struct SegmentTimelineEntry {
    t: Option<u64>,
    d: u64,
    r: i64,
}

#[derive(Debug, Clone, Default)]
struct SegmentTemplateSpec {
    initialization: Option<String>,
    media: Option<String>,
    start_number: u64,
    timescale: u64,
    duration: Option<u64>,
    timeline: Vec<SegmentTimelineEntry>,
}

#[derive(Debug, Clone, Default)]
struct SegmentListUrl {
    media: String,
    media_range: Option<(u64, u64)>,
}

#[derive(Debug, Clone, Default)]
struct SegmentListSpec {
    init_source_url: Option<String>,
    init_range: Option<(u64, u64)>,
    urls: Vec<SegmentListUrl>,
}

#[derive(Debug, Clone, Default)]
struct SegmentBaseSpec {
    init_source_url: Option<String>,
    init_range: Option<(u64, u64)>,
}

#[derive(Debug, Clone, Default)]
struct InheritanceScope {
    base_url: String,
    duration_seconds: Option<f64>,
    content_type: Option<String>,
    mime_type: Option<String>,
    codecs: Option<String>,
    lang: Option<String>,
    segment_template: Option<SegmentTemplateSpec>,
    segment_list: Option<SegmentListSpec>,
    segment_base: Option<SegmentBaseSpec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveScope {
    Mpd,
    Period,
    AdaptationSet,
    Representation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveSegmentContainer {
    Template,
    List,
    Base,
}

pub fn parse_iso8601_duration(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if !trimmed.starts_with('P') {
        return None;
    }
    let body = &trimmed[1..];
    let (date_part, time_part) = body.split_once('T').unwrap_or((body, ""));

    let mut total_seconds = 0.0f64;
    let mut num_buf = String::new();
    let mut parsed_any = false;

    for ch in date_part.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            num_buf.push(ch);
        } else if !num_buf.is_empty() {
            let value: f64 = num_buf.parse().ok()?;
            num_buf.clear();
            parsed_any = true;
            match ch {
                'D' => total_seconds += value * 86_400.0,
                'W' => total_seconds += value * 7.0 * 86_400.0,
                'M' => total_seconds += value * 30.0 * 86_400.0,
                'Y' => total_seconds += value * 365.0 * 86_400.0,
                _ => return None,
            }
        }
    }

    num_buf.clear();
    for ch in time_part.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            num_buf.push(ch);
        } else if !num_buf.is_empty() {
            let value: f64 = num_buf.parse().ok()?;
            num_buf.clear();
            parsed_any = true;
            match ch {
                'H' => total_seconds += value * 3_600.0,
                'M' => total_seconds += value * 60.0,
                'S' => total_seconds += value,
                _ => return None,
            }
        }
    }

    parsed_any.then_some(total_seconds)
}

pub fn expand_dash_template(
    template: &str,
    representation_id: &str,
    bandwidth: u64,
    number: u64,
    time: u64,
) -> String {
    let mut out = String::with_capacity(template.len() + 16);
    let chars: Vec<char> = template.chars().collect();
    let mut i = 0usize;

    while i < chars.len() {
        if chars[i] == '$' {
            if let Some(end_rel) = chars[i + 1..].iter().position(|&c| c == '$') {
                let token: String = chars[i + 1..i + 1 + end_rel].iter().collect();
                if token.is_empty() {
                    out.push('$');
                } else if token == "RepresentationID" {
                    out.push_str(representation_id);
                } else if token == "Bandwidth" {
                    out.push_str(&bandwidth.to_string());
                } else if let Some(formatted) = format_numeric_token(&token, "Number", number)
                    .or_else(|| format_numeric_token(&token, "Time", time))
                {
                    out.push_str(&formatted);
                } else {
                    out.push('$');
                    out.push_str(&token);
                    out.push('$');
                }
                i += end_rel + 2;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }

    out
}

fn format_numeric_token(token: &str, name: &str, value: u64) -> Option<String> {
    if token == name {
        return Some(value.to_string());
    }
    let rest = token.strip_prefix(name)?;
    let fmt = rest.strip_prefix('%')?.strip_suffix('d')?;
    let width = fmt.parse::<usize>().ok()?;
    Some(format!("{value:0width$}"))
}

fn parse_byte_range_pair(raw: &str) -> Option<(u64, u64)> {
    let (start_str, end_str) = raw.trim().split_once('-')?;
    let start = start_str.trim().parse::<u64>().ok()?;
    let end = end_str.trim().parse::<u64>().ok()?;
    (end >= start).then_some((start, end))
}

fn resolve_url(base: &str, relative_or_abs: &str) -> Result<String> {
    let cleaned = relative_or_abs.trim().replace("&amp;", "&");
    let resolved = if cleaned.starts_with("http://") || cleaned.starts_with("https://") {
        cleaned
    } else {
        Url::parse(base)?.join(&cleaned)?.to_string()
    };
    vdpro_core::validation::assert_http_url(&resolved)?;
    Ok(resolved)
}

fn get_attr(e: &BytesStart<'_>, target: &str) -> Result<Option<String>> {
    for attr_res in e.attributes() {
        let attr = attr_res.map_err(|err| anyhow!("MPD 属性解析失败: {}", err))?;
        let key = attr.key.local_name().into_inner();
        if key == target {
            let val = attr
                .normalized_value(XmlVersion::Implicit1_0)
                .map_err(|err| anyhow!("MPD 属性值转义失败: {}", err))?;
            return Ok(Some(val.into_owned()));
        }
    }
    Ok(None)
}

fn merge_template(
    parent: Option<&SegmentTemplateSpec>,
    override_spec: &SegmentTemplateSpec,
) -> SegmentTemplateSpec {
    let mut merged = parent.cloned().unwrap_or_else(|| SegmentTemplateSpec {
        start_number: 1,
        timescale: 1,
        ..Default::default()
    });
    if override_spec.initialization.is_some() {
        merged.initialization = override_spec.initialization.clone();
    }
    if override_spec.media.is_some() {
        merged.media = override_spec.media.clone();
    }
    if override_spec.start_number > 0 {
        merged.start_number = override_spec.start_number;
    }
    if override_spec.timescale > 0 {
        merged.timescale = override_spec.timescale;
    }
    if override_spec.duration.is_some() {
        merged.duration = override_spec.duration;
    }
    if !override_spec.timeline.is_empty() {
        merged.timeline = override_spec.timeline.clone();
    }
    merged
}

pub fn parse_dash_manifest(mpd_url: &str, xml: &str) -> Result<DashManifest> {
    vdpro_core::validation::assert_http_url(mpd_url)?;
    let xml = xml.strip_prefix('\u{feff}').unwrap_or(xml);
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut is_live = false;
    let mut mpd_duration_seconds: Option<f64> = None;
    let mut representations = Vec::new();

    let mut scope_stack: Vec<(ActiveScope, InheritanceScope)> = Vec::new();
    let mut current_rep_id = String::new();
    let mut current_rep_bandwidth = 0u64;
    let mut current_rep_width: Option<u32> = None;
    let mut current_rep_height: Option<u32> = None;
    let mut current_seg_container: Option<ActiveSegmentContainer> = None;
    let mut reading_base_url = false;
    let mut base_url_text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let tag = e.local_name().into_inner();
                match tag {
                    "MPD" => {
                        if let Some(t) = get_attr(&e, "type")? {
                            is_live = t.eq_ignore_ascii_case("dynamic");
                        }
                        mpd_duration_seconds = get_attr(&e, "mediaPresentationDuration")?
                            .and_then(|v| parse_iso8601_duration(&v));
                        scope_stack.push((
                            ActiveScope::Mpd,
                            InheritanceScope {
                                base_url: mpd_url.to_string(),
                                duration_seconds: mpd_duration_seconds,
                                ..Default::default()
                            },
                        ));
                    }
                    "Period" => {
                        let parent = scope_stack
                            .last()
                            .map(|(_, s)| s.clone())
                            .unwrap_or_default();
                        let duration = get_attr(&e, "duration")?
                            .and_then(|v| parse_iso8601_duration(&v))
                            .or(parent.duration_seconds);
                        scope_stack.push((
                            ActiveScope::Period,
                            InheritanceScope {
                                duration_seconds: duration,
                                ..parent
                            },
                        ));
                    }
                    "AdaptationSet" => {
                        let mut scope = scope_stack
                            .last()
                            .map(|(_, s)| s.clone())
                            .unwrap_or_default();
                        if let Some(v) = get_attr(&e, "contentType")? {
                            scope.content_type = Some(v);
                        }
                        if let Some(v) = get_attr(&e, "mimeType")? {
                            scope.mime_type = Some(v);
                        }
                        if let Some(v) = get_attr(&e, "codecs")? {
                            scope.codecs = Some(v);
                        }
                        if let Some(v) = get_attr(&e, "lang")? {
                            scope.lang = Some(v);
                        }
                        scope_stack.push((ActiveScope::AdaptationSet, scope));
                    }
                    "Representation" => {
                        let attrs =
                            apply_representation_attrs(&e, scope_stack.last().map(|(_, s)| s))?;
                        current_rep_id = attrs.id;
                        current_rep_bandwidth = attrs.bandwidth;
                        current_rep_width = attrs.width;
                        current_rep_height = attrs.height;
                        scope_stack.push((ActiveScope::Representation, attrs.scope));
                    }
                    "BaseURL" => {
                        reading_base_url = true;
                        base_url_text.clear();
                    }
                    "SegmentTemplate" => {
                        if let Some((_, scope)) = scope_stack.last_mut() {
                            let spec = parse_segment_template_attrs(&e)?;
                            scope.segment_template =
                                Some(merge_template(scope.segment_template.as_ref(), &spec));
                            current_seg_container = Some(ActiveSegmentContainer::Template);
                        }
                    }
                    "SegmentList" => {
                        if let Some((_, scope)) = scope_stack.last_mut() {
                            scope.segment_list = Some(SegmentListSpec::default());
                            current_seg_container = Some(ActiveSegmentContainer::List);
                        }
                    }
                    "SegmentBase" => {
                        if let Some((_, scope)) = scope_stack.last_mut() {
                            scope.segment_base = Some(SegmentBaseSpec::default());
                            current_seg_container = Some(ActiveSegmentContainer::Base);
                        }
                    }
                    "Initialization" => {
                        handle_initialization_tag(
                            &e,
                            scope_stack.last_mut().map(|(_, s)| s),
                            current_seg_container,
                        )?;
                    }
                    "SegmentURL" => {
                        handle_segment_url_tag(&e, scope_stack.last_mut().map(|(_, s)| s))?;
                    }
                    "S" => {
                        handle_timeline_s_tag(&e, scope_stack.last_mut().map(|(_, s)| s))?;
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let tag = e.local_name().into_inner();
                match tag {
                    "Representation" => {
                        let attrs =
                            apply_representation_attrs(&e, scope_stack.last().map(|(_, s)| s))?;
                        let rep = build_representation(
                            &attrs.scope,
                            attrs.id,
                            attrs.bandwidth,
                            attrs.width,
                            attrs.height,
                        )?;
                        representations.push(rep);
                    }
                    "SegmentTemplate" => {
                        if let Some((_, scope)) = scope_stack.last_mut() {
                            let spec = parse_segment_template_attrs(&e)?;
                            scope.segment_template =
                                Some(merge_template(scope.segment_template.as_ref(), &spec));
                        }
                    }
                    "SegmentBase" => {
                        if let Some((_, scope)) = scope_stack.last_mut() {
                            if scope.segment_base.is_none() {
                                scope.segment_base = Some(SegmentBaseSpec::default());
                            }
                        }
                    }
                    "Initialization" => {
                        handle_initialization_tag(
                            &e,
                            scope_stack.last_mut().map(|(_, s)| s),
                            current_seg_container,
                        )?;
                    }
                    "SegmentURL" => {
                        handle_segment_url_tag(&e, scope_stack.last_mut().map(|(_, s)| s))?;
                    }
                    "S" => {
                        handle_timeline_s_tag(&e, scope_stack.last_mut().map(|(_, s)| s))?;
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) if reading_base_url => {
                base_url_text.push_str(e.as_ref());
            }
            Ok(Event::End(e)) => {
                let tag = e.local_name().into_inner();
                match tag {
                    "BaseURL" => {
                        reading_base_url = false;
                        if let Some((_, scope)) = scope_stack.last_mut() {
                            let candidate = base_url_text.trim();
                            if !candidate.is_empty() {
                                scope.base_url = resolve_url(&scope.base_url, candidate)?;
                            }
                        }
                        base_url_text.clear();
                    }
                    "SegmentTemplate" | "SegmentList" | "SegmentBase" => {
                        current_seg_container = None;
                    }
                    "Representation" => {
                        if let Some((ActiveScope::Representation, scope)) = scope_stack.pop() {
                            let rep = build_representation(
                                &scope,
                                current_rep_id.clone(),
                                current_rep_bandwidth,
                                current_rep_width,
                                current_rep_height,
                            )?;
                            representations.push(rep);
                        }
                    }
                    "AdaptationSet" => {
                        if matches!(scope_stack.last(), Some((ActiveScope::AdaptationSet, _))) {
                            scope_stack.pop();
                        }
                    }
                    "Period" => {
                        if matches!(scope_stack.last(), Some((ActiveScope::Period, _))) {
                            scope_stack.pop();
                        }
                    }
                    "MPD" => {
                        if matches!(scope_stack.last(), Some((ActiveScope::Mpd, _))) {
                            scope_stack.pop();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => bail!("MPEG-DASH MPD 解析失败: {}", err),
            _ => {}
        }
    }

    if representations.is_empty() {
        bail!("MPEG-DASH MPD 中未找到有效 Representation");
    }

    Ok(DashManifest {
        is_live,
        duration_seconds: mpd_duration_seconds,
        representations,
    })
}

struct RepresentationAttrs {
    scope: InheritanceScope,
    id: String,
    bandwidth: u64,
    width: Option<u32>,
    height: Option<u32>,
}

fn apply_representation_attrs(
    e: &BytesStart<'_>,
    parent_scope: Option<&InheritanceScope>,
) -> Result<RepresentationAttrs> {
    let mut scope = parent_scope.cloned().unwrap_or_default();
    let id = get_attr(e, "id")?.unwrap_or_else(|| "rep".to_string());
    let bandwidth = get_attr(e, "bandwidth")?
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let width = get_attr(e, "width")?.and_then(|v| v.parse::<u32>().ok());
    let height = get_attr(e, "height")?.and_then(|v| v.parse::<u32>().ok());
    if let Some(v) = get_attr(e, "mimeType")? {
        scope.mime_type = Some(v);
    }
    if let Some(v) = get_attr(e, "codecs")? {
        scope.codecs = Some(v);
    }
    Ok(RepresentationAttrs {
        scope,
        id,
        bandwidth,
        width,
        height,
    })
}

fn parse_segment_template_attrs(e: &BytesStart<'_>) -> Result<SegmentTemplateSpec> {
    Ok(SegmentTemplateSpec {
        initialization: get_attr(e, "initialization")?,
        media: get_attr(e, "media")?,
        start_number: get_attr(e, "startNumber")?
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0),
        timescale: get_attr(e, "timescale")?
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0),
        duration: get_attr(e, "duration")?.and_then(|v| v.parse::<u64>().ok()),
        timeline: Vec::new(),
    })
}

fn handle_initialization_tag(
    e: &BytesStart<'_>,
    scope: Option<&mut InheritanceScope>,
    container: Option<ActiveSegmentContainer>,
) -> Result<()> {
    let Some(scope) = scope else {
        return Ok(());
    };
    let source_url = get_attr(e, "sourceURL")?;
    let range = get_attr(e, "range")?.and_then(|r| parse_byte_range_pair(&r));

    match container {
        Some(ActiveSegmentContainer::List) => {
            if let Some(ref mut list) = scope.segment_list {
                list.init_source_url = source_url;
                list.init_range = range;
            }
        }
        Some(ActiveSegmentContainer::Base) => {
            if let Some(ref mut base) = scope.segment_base {
                base.init_source_url = source_url;
                base.init_range = range;
            }
        }
        _ => {}
    }

    Ok(())
}

fn handle_segment_url_tag(e: &BytesStart<'_>, scope: Option<&mut InheritanceScope>) -> Result<()> {
    let Some(scope) = scope else {
        return Ok(());
    };
    let Some(ref mut list) = scope.segment_list else {
        return Ok(());
    };
    let media = get_attr(e, "media")?.unwrap_or_default();
    let media_range = get_attr(e, "mediaRange")?.and_then(|r| parse_byte_range_pair(&r));
    if !media.is_empty() || media_range.is_some() {
        list.urls.push(SegmentListUrl { media, media_range });
    }
    Ok(())
}

fn handle_timeline_s_tag(e: &BytesStart<'_>, scope: Option<&mut InheritanceScope>) -> Result<()> {
    let Some(scope) = scope else {
        return Ok(());
    };
    let Some(ref mut tmpl) = scope.segment_template else {
        return Ok(());
    };
    let t = get_attr(e, "t")?.and_then(|v| v.parse::<u64>().ok());
    let d = get_attr(e, "d")?
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let r = get_attr(e, "r")?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    if d > 0 {
        tmpl.timeline.push(SegmentTimelineEntry { t, d, r });
    }
    Ok(())
}

fn classify_track_kind(
    content_type: Option<&str>,
    mime_type: Option<&str>,
    codecs: Option<&str>,
    width: Option<u32>,
) -> DashTrackKind {
    if let Some(ct) = content_type {
        let lower = ct.to_ascii_lowercase();
        if lower == "video" {
            return DashTrackKind::Video;
        }
        if lower == "audio" {
            return DashTrackKind::Audio;
        }
    }
    if let Some(mime) = mime_type {
        let lower = mime.to_ascii_lowercase();
        if lower.starts_with("video/") {
            return DashTrackKind::Video;
        }
        if lower.starts_with("audio/") {
            return DashTrackKind::Audio;
        }
    }
    if width.is_some() {
        return DashTrackKind::Video;
    }
    if let Some(c) = codecs {
        let lower = c.to_ascii_lowercase();
        if lower.contains("avc")
            || lower.contains("hvc")
            || lower.contains("hev")
            || lower.contains("vp9")
            || lower.contains("av01")
        {
            return DashTrackKind::Video;
        }
        if lower.contains("mp4a")
            || lower.contains("opus")
            || lower.contains("ec-3")
            || lower.contains("ac-3")
        {
            return DashTrackKind::Audio;
        }
    }
    DashTrackKind::Unknown
}

fn build_representation(
    scope: &InheritanceScope,
    id: String,
    bandwidth: u64,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<DashRepresentation> {
    let kind = classify_track_kind(
        scope.content_type.as_deref(),
        scope.mime_type.as_deref(),
        scope.codecs.as_deref(),
        width,
    );

    let mut init_segment: Option<DashInitSegment> = None;
    let mut segments = Vec::new();

    if let Some(ref tmpl) = scope.segment_template {
        if let Some(ref init_tmpl) = tmpl.initialization {
            let expanded = expand_dash_template(init_tmpl, &id, bandwidth, tmpl.start_number, 0);
            init_segment = Some(DashInitSegment {
                url: resolve_url(&scope.base_url, &expanded)?,
                byte_range: None,
            });
        }

        if let Some(ref media_tmpl) = tmpl.media {
            if !tmpl.timeline.is_empty() {
                let mut current_time = tmpl.timeline.first().and_then(|s| s.t).unwrap_or(0);
                let mut seq_offset = 0u64;
                for entry in &tmpl.timeline {
                    if let Some(explicit_t) = entry.t {
                        current_time = explicit_t;
                    }
                    let repeat = entry.r.max(0) as u64;
                    let occurrences = repeat.saturating_add(1).min(50_000);
                    for _ in 0..occurrences {
                        let seg_num = tmpl.start_number.saturating_add(seq_offset);
                        let expanded =
                            expand_dash_template(media_tmpl, &id, bandwidth, seg_num, current_time);
                        let resolved = resolve_url(&scope.base_url, &expanded)?;
                        segments.push(DashSegment {
                            index: segments.len(),
                            url: resolved,
                            byte_range: None,
                            init_segment: init_segment.clone(),
                        });
                        current_time = current_time.saturating_add(entry.d);
                        seq_offset = seq_offset.saturating_add(1);
                    }
                }
            } else if let Some(dur) = tmpl.duration.filter(|&d| d > 0) {
                let timescale = tmpl.timescale.max(1);
                let seg_secs = dur as f64 / timescale as f64;
                let count = scope
                    .duration_seconds
                    .map(|total| (total / seg_secs).ceil().max(1.0) as usize)
                    .unwrap_or(1)
                    .min(100_000);

                for idx in 0..count {
                    let seg_num = tmpl.start_number.saturating_add(idx as u64);
                    let seg_time = (idx as u64).saturating_mul(dur);
                    let expanded =
                        expand_dash_template(media_tmpl, &id, bandwidth, seg_num, seg_time);
                    let resolved = resolve_url(&scope.base_url, &expanded)?;
                    segments.push(DashSegment {
                        index: idx,
                        url: resolved,
                        byte_range: None,
                        init_segment: init_segment.clone(),
                    });
                }
            }
        }
    } else if let Some(ref list) = scope.segment_list {
        if list.init_source_url.is_some() || list.init_range.is_some() {
            let init_url = match list.init_source_url.as_deref() {
                Some(raw) if !raw.trim().is_empty() => resolve_url(&scope.base_url, raw)?,
                _ => resolve_url(&scope.base_url, &scope.base_url)?,
            };
            init_segment = Some(DashInitSegment {
                url: init_url,
                byte_range: list.init_range,
            });
        }

        for (idx, item) in list.urls.iter().enumerate() {
            let url = if item.media.trim().is_empty() {
                resolve_url(&scope.base_url, &scope.base_url)?
            } else {
                resolve_url(&scope.base_url, &item.media)?
            };
            segments.push(DashSegment {
                index: idx,
                url,
                byte_range: item.media_range,
                init_segment: init_segment.clone(),
            });
        }
    } else {
        if let Some(ref base_spec) = scope.segment_base {
            if base_spec.init_source_url.is_some() || base_spec.init_range.is_some() {
                let url = match base_spec.init_source_url.as_deref() {
                    Some(raw) if !raw.trim().is_empty() => resolve_url(&scope.base_url, raw)?,
                    _ => resolve_url(&scope.base_url, &scope.base_url)?,
                };
                init_segment = Some(DashInitSegment {
                    url,
                    byte_range: base_spec.init_range,
                });
            }
        }
        let media_url = resolve_url(&scope.base_url, &scope.base_url)?;
        segments.push(DashSegment {
            index: 0,
            url: media_url,
            byte_range: None,
            init_segment: init_segment.clone(),
        });
    }

    Ok(DashRepresentation {
        id,
        kind,
        bandwidth,
        width,
        height,
        mime_type: scope.mime_type.clone(),
        codecs: scope.codecs.clone(),
        lang: scope.lang.clone(),
        init_segment,
        segments,
    })
}

pub fn select_dash_tracks<'a>(
    manifest: &'a DashManifest,
    format_selector: Option<&str>,
    preferred_language: Option<&str>,
) -> DashTrackSelection<'a> {
    let videos: Vec<&'a DashRepresentation> = manifest
        .representations
        .iter()
        .filter(|r| !r.segments.is_empty() && r.kind != DashTrackKind::Audio)
        .collect();
    let audios: Vec<&'a DashRepresentation> = manifest
        .representations
        .iter()
        .filter(|r| !r.segments.is_empty() && r.kind == DashTrackKind::Audio)
        .collect();

    let pick_audio = || -> Option<&'a DashRepresentation> {
        if let Some(pref) = preferred_language
            .map(str::trim)
            .filter(|lang| !lang.is_empty())
        {
            let pref_lower = pref.to_ascii_lowercase();
            if let Some(matched) = audios
                .iter()
                .filter(|r| {
                    r.lang.as_deref().is_some_and(|l| {
                        let ll = l.to_ascii_lowercase();
                        ll == pref_lower || ll.starts_with(&pref_lower)
                    })
                })
                .max_by_key(|r| r.bandwidth)
            {
                return Some(*matched);
            }
        }
        audios.iter().max_by_key(|r| r.bandwidth).copied()
    };

    if format_selector
        .map(str::trim)
        .is_some_and(|sel| sel.eq_ignore_ascii_case("audio"))
    {
        if let Some(audio) = pick_audio() {
            return DashTrackSelection {
                video: None,
                audio: Some(audio),
            };
        }
    }

    let max_height = format_selector.and_then(|sel| {
        sel.trim()
            .to_ascii_lowercase()
            .strip_suffix('p')
            .and_then(|digits| digits.parse::<u32>().ok())
    });

    let selected_video = if let Some(cap) = max_height {
        videos
            .iter()
            .filter(|r| r.height.is_some_and(|h| h <= cap))
            .max_by_key(|r| (r.height.unwrap_or(0), r.bandwidth))
            .copied()
            .or_else(|| {
                videos
                    .iter()
                    .filter(|r| r.height.is_some())
                    .min_by_key(|r| (r.height.unwrap_or(u32::MAX), r.bandwidth))
                    .copied()
            })
            .or_else(|| videos.iter().max_by_key(|r| r.bandwidth).copied())
    } else {
        videos.iter().max_by_key(|r| r.bandwidth).copied()
    };

    DashTrackSelection {
        video: selected_video,
        audio: pick_audio(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso8601_durations() {
        assert_eq!(parse_iso8601_duration("PT12S"), Some(12.0));
        assert_eq!(parse_iso8601_duration("PT2M30.5S"), Some(150.5));
        assert_eq!(parse_iso8601_duration("PT1H1M1S"), Some(3661.0));
        assert_eq!(parse_iso8601_duration("P1DT0H0M10S"), Some(86410.0));
        assert_eq!(parse_iso8601_duration("invalid"), None);
    }

    #[test]
    fn parses_segment_template_duration_and_selects_tracks() {
        let mpd = r#"<?xml version="1.0" encoding="utf-8"?>
<MPD type="static" mediaPresentationDuration="PT10S">
  <Period duration="PT10S">
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <SegmentTemplate initialization="v/$RepresentationID$/init.mp4" media="v/$RepresentationID$/seg-$Number%04d$.m4s" startNumber="1" timescale="1000" duration="5000" />
      <Representation id="1080p" bandwidth="4000000" width="1920" height="1080" />
      <Representation id="720p" bandwidth="2000000" width="1280" height="720" />
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="en">
      <SegmentTemplate initialization="a/$RepresentationID$/init.mp4" media="a/$RepresentationID$/seg-$Number$.m4s" startNumber="1" timescale="1000" duration="5000" />
      <Representation id="aud_en" bandwidth="128000" />
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="ja">
      <SegmentTemplate initialization="a/$RepresentationID$/init.mp4" media="a/$RepresentationID$/seg-$Number$.m4s" startNumber="1" timescale="1000" duration="5000" />
      <Representation id="aud_ja" bandwidth="192000" />
    </AdaptationSet>
  </Period>
</MPD>"#;

        let manifest =
            parse_dash_manifest("https://cdn.example.com/dash/manifest.mpd", mpd).unwrap();
        assert!(!manifest.is_live);
        assert_eq!(manifest.representations.len(), 4);

        let selection = select_dash_tracks(&manifest, Some("720p"), Some("ja"));
        let video = selection.video.unwrap();
        assert_eq!(video.id, "720p");
        assert_eq!(
            video.init_segment.as_ref().unwrap().url,
            "https://cdn.example.com/dash/v/720p/init.mp4"
        );
        assert_eq!(video.segments.len(), 2);
        assert_eq!(
            video.segments[0].url,
            "https://cdn.example.com/dash/v/720p/seg-0001.m4s"
        );
        assert_eq!(
            video.segments[1].url,
            "https://cdn.example.com/dash/v/720p/seg-0002.m4s"
        );

        let audio = selection.audio.unwrap();
        assert_eq!(audio.id, "aud_ja");
        assert_eq!(
            audio.segments[1].url,
            "https://cdn.example.com/dash/a/aud_ja/seg-2.m4s"
        );
    }

    #[test]
    fn parses_segment_timeline_with_repeats_and_segment_list_ranges() {
        let mpd = r#"<?xml version="1.0"?>
<MPD type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <BaseURL>https://media.example.com/stream/</BaseURL>
      <SegmentTemplate initialization="init-$$-$RepresentationID$.mp4" media="chunk-$Time$.m4s" timescale="1000">
        <SegmentTimeline>
          <S t="0" d="1000" r="2" />
          <S d="2000" />
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="v1" bandwidth="1500000" width="1280" height="720" />
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="en">
      <Representation id="a1" bandwidth="128000">
        <BaseURL>audio.mp4</BaseURL>
        <SegmentList>
          <Initialization range="0-99" />
          <SegmentURL media="audio.mp4" mediaRange="100-199" />
          <SegmentURL media="audio.mp4" mediaRange="200-299" />
        </SegmentList>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#;

        let manifest = parse_dash_manifest("https://cdn.example.com/manifest.mpd", mpd).unwrap();
        let selection = select_dash_tracks(&manifest, None, None);

        let video = selection.video.unwrap();
        assert_eq!(
            video.init_segment.as_ref().unwrap().url,
            "https://media.example.com/stream/init-$-v1.mp4"
        );
        assert_eq!(video.segments.len(), 4);
        assert_eq!(
            video.segments[0].url,
            "https://media.example.com/stream/chunk-0.m4s"
        );
        assert_eq!(
            video.segments[2].url,
            "https://media.example.com/stream/chunk-2000.m4s"
        );
        assert_eq!(
            video.segments[3].url,
            "https://media.example.com/stream/chunk-3000.m4s"
        );

        let audio = selection.audio.unwrap();
        assert_eq!(
            audio.init_segment.as_ref().unwrap().byte_range,
            Some((0, 99))
        );
        assert_eq!(audio.segments.len(), 2);
        assert_eq!(audio.segments[0].byte_range, Some((100, 199)));
        assert_eq!(audio.segments[1].byte_range, Some((200, 299)));
    }
}
