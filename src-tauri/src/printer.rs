//! Imprimante à tickets de ce poste : impression directe, sans fenêtre (commandes ESC/POS préparées par
//! l'interface), ouverture du tiroir-caisse et coupe du papier.
//!
//! Le réglage est propre à chaque PC (`imprimante.json` dans le dossier de l'application) : chaque caisse
//! a son imprimante. Windows : file d'impression en mode « RAW » (winspool). Linux / macOS : `lp -o raw`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PrinterConfig {
    /// Nom de l'imprimante dans le système ; vide = fenêtre d'impression habituelle.
    pub printer: String,
    /// Imprimer le ticket tout seul après chaque vente.
    pub auto_print: bool,
    /// Ouvrir le tiroir-caisse (branché sur l'imprimante) quand la vente comprend des espèces.
    pub open_drawer: bool,
}

pub fn load(path: &PathBuf) -> PrinterConfig {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save(path: &PathBuf, c: &PrinterConfig) -> std::io::Result<()> {
    let mut c = c.clone();
    c.printer = c.printer.trim().chars().take(200).collect();
    std::fs::write(path, serde_json::to_string_pretty(&c).unwrap_or_default())
}

/// Imprimantes installées sur ce PC.
pub fn list() -> Vec<String> {
    let mut names = sys::list();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// Envoie des données brutes (ESC/POS) à l'imprimante, telles quelles.
pub fn send(printer: &str, data: &[u8]) -> Result<(), String> {
    if printer.trim().is_empty() {
        return Err("Choisissez d'abord l'imprimante à tickets dans les Paramètres.".into());
    }
    if data.is_empty() || data.len() > 2_000_000 {
        return Err("Ticket à imprimer invalide.".into());
    }
    sys::send(printer.trim(), data)
}

#[cfg(windows)]
mod sys {
    use std::ffi::c_void;

    #[repr(C)]
    struct DocInfo1W {
        doc_name: *const u16,
        output_file: *const u16,
        datatype: *const u16,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct PrinterInfo4W {
        printer_name: *mut u16,
        server_name: *mut u16,
        attributes: u32,
    }

    #[link(name = "winspool")]
    extern "system" {
        fn OpenPrinterW(name: *const u16, handle: *mut *mut c_void, defaults: *const c_void) -> i32;
        fn ClosePrinter(handle: *mut c_void) -> i32;
        fn StartDocPrinterW(handle: *mut c_void, level: u32, doc: *const DocInfo1W) -> u32;
        fn EndDocPrinter(handle: *mut c_void) -> i32;
        fn StartPagePrinter(handle: *mut c_void) -> i32;
        fn EndPagePrinter(handle: *mut c_void) -> i32;
        fn WritePrinter(handle: *mut c_void, buf: *const c_void, len: u32, written: *mut u32) -> i32;
        fn EnumPrintersW(flags: u32, name: *const u16, level: u32, buf: *mut u8, size: u32, needed: *mut u32, returned: *mut u32) -> i32;
    }

    const PRINTER_ENUM_LOCAL: u32 = 0x2;
    const PRINTER_ENUM_CONNECTIONS: u32 = 0x4;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn from_wide(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut len = 0;
        while *p.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
    }

    pub fn list() -> Vec<String> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut needed, mut returned) = (0u32, 0u32);
        unsafe {
            EnumPrintersW(flags, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut needed, &mut returned);
            if needed == 0 {
                return Vec::new();
            }
            // Tampon aligné sur 8 octets (les structures contiennent des pointeurs).
            let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
            if EnumPrintersW(flags, std::ptr::null(), 4, buf.as_mut_ptr() as *mut u8, needed, &mut needed, &mut returned) == 0 {
                return Vec::new();
            }
            let infos = std::slice::from_raw_parts(buf.as_ptr() as *const PrinterInfo4W, returned as usize);
            infos.iter().map(|i| from_wide(i.printer_name)).filter(|n| !n.is_empty()).collect()
        }
    }

    pub fn send(printer: &str, data: &[u8]) -> Result<(), String> {
        let name = wide(printer);
        let doc = wide("Ticket GestiMarket");
        let raw = wide("RAW");
        unsafe {
            let mut h: *mut c_void = std::ptr::null_mut();
            if OpenPrinterW(name.as_ptr(), &mut h, std::ptr::null()) == 0 || h.is_null() {
                return Err(format!("Imprimante « {printer} » introuvable : vérifiez qu'elle est allumée et installée sur ce PC."));
            }
            let info = DocInfo1W { doc_name: doc.as_ptr(), output_file: std::ptr::null(), datatype: raw.as_ptr() };
            let result = (|| {
                if StartDocPrinterW(h, 1, &info) == 0 {
                    return Err(format!("L'imprimante « {printer} » refuse l'impression directe."));
                }
                StartPagePrinter(h);
                let mut written = 0u32;
                let ok = WritePrinter(h, data.as_ptr() as *const c_void, data.len() as u32, &mut written) != 0;
                EndPagePrinter(h);
                EndDocPrinter(h);
                if !ok || written as usize != data.len() {
                    return Err(format!("Impression incomplète sur « {printer} »."));
                }
                Ok(())
            })();
            ClosePrinter(h);
            result
        }
    }
}

#[cfg(not(windows))]
mod sys {
    use std::io::Write;
    use std::process::{Command, Stdio};

    pub fn list() -> Vec<String> {
        Command::new("lpstat")
            .arg("-e")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
            .unwrap_or_default()
    }

    pub fn send(printer: &str, data: &[u8]) -> Result<(), String> {
        let mut child = Command::new("lp")
            .args(["-d", printer, "-o", "raw"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .map_err(|e| format!("Impression impossible : {e}"))?;
        child.stdin.take().map(|mut s| s.write_all(data)).transpose().map_err(|e| format!("Impression impossible : {e}"))?;
        let status = child.wait().map_err(|e| format!("Impression impossible : {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("L'imprimante « {printer} » refuse l'impression directe."))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reglage_par_poste_et_envoi_controle() {
        let path = std::env::temp_dir().join(format!("gm-imprimante-{}.json", std::process::id()));
        assert_eq!(load(&path).printer, "");
        save(&path, &PrinterConfig { printer: "  XP-80C  ".into(), auto_print: true, open_drawer: true }).unwrap();
        let c = load(&path);
        assert_eq!((c.printer.as_str(), c.auto_print, c.open_drawer), ("XP-80C", true, true));
        let _ = std::fs::remove_file(&path);
        assert!(send("", b"x").is_err());
        assert!(send("XP-80C", b"").is_err());
    }
}
