//! Commandes propres à cet appareil, jamais servies aux autres appareils du réseau : restauration des
//! sauvegardes et Espace propriétaire (compte Eden Dev).
//!
//! L'application les appelle avec l'origine `Local`. Les tests d'interface (compilations de développement
//! seulement) les appellent par le serveur avec la session de leur jeton, voir `network.rs`.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::error::{invalid, AppError, AppResult};
use crate::services::{audit, auth, backup, catalog, loyalty};
use crate::state::{Access, AppState, Origin, SessionUser};

fn text(a: &Value, k: &str) -> Option<String> {
    a.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

/// Dossier de travail de la restauration (copie en clair de la sauvegarde, effacée ensuite).
fn work_dir(state: &AppState) -> PathBuf {
    state.db_path.parent().map(|d| d.join("Restauration")).unwrap_or_else(|| PathBuf::from("Restauration"))
}

/// Appareil neuf (aucune boutique configurée) : la restauration est libre. Sinon : administrateur connecté.
fn who(state: &AppState, origin: &Origin) -> AppResult<Option<SessionUser>> {
    if auth::needs_setup(&state.conn())? {
        return Ok(None);
    }
    state.require(origin, Access::Admin).map(Some)
}

pub fn call(state: &AppState, origin: &Origin, cmd: &str, a: Value) -> AppResult<Value> {
    match cmd {
        "backup_list" => {
            who(state, origin)?;
            let files = backup::list(&state.conn())?;
            serde_json::to_value(files).map_err(|e| AppError::Internal(e.to_string()))
        }
        "backup_inspect" => {
            who(state, origin)?;
            let path = text(&a, "path").ok_or_else(|| AppError::Validation("Choisissez un fichier de sauvegarde.".into()))?;
            let info = backup::inspect(&state.conn(), Path::new(&path), &work_dir(state), text(&a, "password").as_deref())?;
            serde_json::to_value(info).map_err(|e| AppError::Internal(e.to_string()))
        }
        "backup_restore" => restore(state, origin, &a),
        "owner" => {
            let dir = state.db_path.parent().map(Path::to_path_buf).unwrap_or_default();
            let action = text(&a, "action").unwrap_or_default();
            crate::account::owner_action(&dir, &action, a.get("args").unwrap_or(&Value::Null)).map_err(AppError::Validation)
        }
        _ => invalid(format!("Opération inconnue : {cmd}")),
    }
}

/// Restauration : contrôles, remplacement de la base, puis tout ce qui dépend d'elle (licence de cet
/// appareil, essai, codes-barres, vignettes, sessions). Chacun se reconnecte avec les codes PIN de la sauvegarde.
fn restore(state: &AppState, origin: &Origin, a: &Value) -> AppResult<Value> {
    let user = who(state, origin)?;
    let path = text(a, "path").ok_or_else(|| AppError::Validation("Choisissez un fichier de sauvegarde.".into()))?;
    if user.is_some() {
        let Some(pin) = text(a, "pin") else {
            return invalid("Code PIN de l'administrateur requis pour restaurer une sauvegarde.");
        };
        crate::rpc::dispatch(state, origin, "verify_pin", json!({ "pin": pin, "level": "admin", "action": "Restauration d'une sauvegarde" }))?;
    }
    let file = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let done = {
        let mut conn = state.conn();
        let done = backup::restore(&mut conn, Path::new(&path), &work_dir(state), text(a, "password").as_deref(), user.is_none())?;
        crate::license::after_restore(&conn, &done.before);
        crate::license::ensure_trial(&conn);
        if let Err(e) = catalog::fill_missing_barcodes(&conn) {
            crate::journal::error(format!("Attribution des codes-barres impossible : {e}"));
        }
        if let Err(e) = loyalty::expire_all(&conn) {
            crate::journal::error(format!("Expiration des bonus fidélité impossible : {e}"));
        }
        crate::report::refresh(&conn);
        let by = user.as_ref().map(|u| u.full_name.clone()).unwrap_or_else(|| "premier démarrage".into());
        audit::log_system(&conn, "Sauvegarde restaurée", "system", None, format!("{file} — par {by}"))?;
        done
    };
    // Les vignettes des photos sont celles de l'ancienne base : refaites à la demande.
    let _ = std::fs::remove_dir_all(state.thumbs_dir());
    state.logout_all();
    crate::journal::info(format!("Sauvegarde restaurée : {file}"));
    Ok(json!({ "shop_name": done.shop_name, "safety_copy": done.safety_copy }))
}
