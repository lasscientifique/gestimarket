use serde::{Serialize, Serializer};

/// Erreur applicative. Elle est sérialisée en simple message (en français)
/// pour être affichée telle quelle dans l'interface.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("Session expirée ou utilisateur non connecté. Veuillez vous reconnecter.")]
    Unauthenticated,
    #[error("Accès refusé : vous n'avez pas les droits nécessaires pour cette action.")]
    Forbidden,
    #[error("{0} introuvable.")]
    NotFound(&'static str),
    #[error("Erreur de base de données : {0}")]
    Database(String),
    #[error("Erreur de fichier : {0}")]
    Io(#[from] std::io::Error),
    #[error("Erreur interne : {0}")]
    Internal(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match &e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("Élément"),
            rusqlite::Error::SqliteFailure(err, msg)
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                let m = msg.clone().unwrap_or_default();
                let text = if m.contains("UNIQUE") {
                    if m.contains("barcode") {
                        "Ce code-barres est déjà utilisé par un autre produit."
                    } else if m.contains("username") {
                        "Ce nom d'utilisateur existe déjà."
                    } else if m.contains("categories") {
                        "Une catégorie porte déjà ce nom."
                    } else {
                        "Cette valeur existe déjà (doublon)."
                    }
                } else if m.contains("FOREIGN KEY") {
                    "Opération impossible : cet élément est référencé ailleurs."
                } else {
                    return AppError::Database(m);
                };
                AppError::Validation(text.to_string())
            }
            _ => AppError::Database(e.to_string()),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Raccourci pour retourner une erreur de validation.
pub fn invalid<T>(msg: impl Into<String>) -> AppResult<T> {
    Err(AppError::Validation(msg.into()))
}
