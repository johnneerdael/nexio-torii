<p align="center">
  <img src="https://raw.githubusercontent.com/johnneerdael/nexio-torii/main/static/nexio-torii.png" width="420" alt="Nexio Torii">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Stremio-Addon-8a5a9e?style=for-the-badge&logo=stremio" alt="Stremio Addon">
  <img src="https://img.shields.io/badge/GHCR-Ready-2496ED?style=for-the-badge&logo=docker" alt="GHCR Ready">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License MIT">
</p>

# ⛩️ Nexio Torii

Nexio Torii is a Nexio/Stremio addon for anime discovery and playback through Nyaa-powered torrent search, StremThru premium unlockers, and optional P2P streaming.

It is built for users who want broad anime coverage without giving up control of their accounts or relying on a server-side database. Your configuration is stored in your private manifest URL, while stream availability and playback are resolved on demand.

## **What it does well:**
### ⚡ **Multi-provider premium playback**  
Use StremThru-backed unlockers including RealDebrid, TorBox, AllDebrid, Premiumize, Debrid-Link, Debrider, EasyDebrid, Offcloud, and PikPak.
### 🔍 **Nyaa-first anime search**  
Searches raw Nyaa releases directly, making it useful for seasonal anime, older shows, OVAs, specials, fansubs, remuxes, and titles that metadata-only addons often miss.
### 📦 **Smarter episode matching**  
Nexio Torii filters torrents by title, season, episode, batch format, language, and resolution to reduce wrong-episode results.
### 🎞️ **Batch-aware playback**  
Large season packs and multi-episode torrents are inspected so the correct file can be selected for the requested episode.
### 💬 **Subtitle extraction**  
Subtitle files found inside cached torrents can be exposed to Stremio as selectable tracks.
### 📡 **Optional P2P mode**  
Users without a premium unlocker can enable direct torrent playback through Stremio's torrent engine.
### 🔒 **Stateless configuration**  
No user database. No stored provider accounts. Your provider credentials are encoded into your personal Stremio manifest URL.

## Nexio Universal-formatter integration

Streams now emit a parser-friendly shape (3-line name + 7-line description with structured fields: `📄 filename · 💾 size · 👥 seeders · 📅 age · 📡 indexer · 🎬 canonical · 📺 episode · 🎯 match · 🆔 cross-IDs`). The Nexio Android app recognises Torii by manifest ID, applies the dedicated `NEXIO_TORII` parser branch, and renders the ⛩ Torii drawable badge. Other Stremio clients fall back to a still-readable description-only render — no breakage for non-Nexio users.

## **Important notes:**

Uncached premium streams may need time to download into your provider cloud before playback is ready.
Raw torrent search depends on uploader naming quality, so always check the stream title before playing.
Some obscure titles may use generated search metadata when official metadata is incomplete.

## **Attribution:**

Nexio Torii is a hard fork of Amatsu and builds on Amatsu's original Nyaa scraping, Stremio addon foundation, parser work, and stateless configuration approach. Props to the Amatsu project and its original author for the base this fork started from.

Original Amatsu source: https://github.com/mralanbourne/Amatsu

**Source code:**  
https://github.com/johnneerdael/nexio-torii
