// Villes proposées par pays (champ « Ville » du compte boutique) : les principales villes des pays de la
// zone franc CFA d'Afrique de l'Ouest et des voisins. Une autre ville se tape librement. Utile pour Sugu Eden
// (chercher près de chez soi, livrer).
const CITIES: Record<string, string[]> = {
  ML: [
    "Bamako", "Sikasso", "Ségou", "Mopti", "Koutiala", "Kayes", "Gao", "Kati", "San", "Tombouctou", "Koulikoro", "Bougouni",
    "Kita", "Nioro du Sahel", "Niono", "Markala", "Fana", "Dioïla", "Kadiolo", "Djenné", "Bandiagara", "Bla", "Nara", "Kidal",
    "Ménaka", "Taoudéni",
  ],
  SN: [
    "Dakar", "Pikine", "Guédiawaye", "Rufisque", "Touba", "Thiès", "Kaolack", "Mbour", "Saint-Louis", "Ziguinchor", "Diourbel",
    "Louga", "Tambacounda", "Kolda", "Richard-Toll", "Fatick", "Kaffrine", "Kédougou", "Matam", "Sédhiou",
  ],
  CI: [
    "Abidjan", "Bouaké", "Daloa", "Yamoussoukro", "San-Pédro", "Korhogo", "Man", "Divo", "Gagnoa", "Abengourou", "Anyama",
    "Soubré", "Bingerville", "Grand-Bassam", "Séguéla", "Odienné", "Bondoukou", "Dabou", "Agboville", "Ferkessédougou",
  ],
  BF: [
    "Ouagadougou", "Bobo-Dioulasso", "Koudougou", "Banfora", "Ouahigouya", "Kaya", "Pouytenga", "Fada N'Gourma", "Tenkodogo",
    "Dédougou", "Dori", "Gaoua", "Ziniaré", "Réo", "Manga",
  ],
  NE: ["Niamey", "Zinder", "Maradi", "Agadez", "Tahoua", "Dosso", "Diffa", "Tillabéri", "Arlit", "Birni-N'Konni", "Madaoua", "Tessaoua"],
  GN: [
    "Conakry", "Nzérékoré", "Kankan", "Kindia", "Labé", "Boké", "Kamsar", "Siguiri", "Mamou", "Faranah", "Kissidougou",
    "Guéckédou", "Coyah", "Dubréka",
  ],
  TG: ["Lomé", "Sokodé", "Kara", "Kpalimé", "Atakpamé", "Dapaong", "Tsévié", "Aného", "Bassar", "Mango"],
  BJ: [
    "Cotonou", "Abomey-Calavi", "Porto-Novo", "Parakou", "Djougou", "Bohicon", "Natitingou", "Abomey", "Lokossa", "Ouidah",
    "Kandi", "Malanville", "Savè", "Pobè",
  ],
  GW: ["Bissau", "Bafatá", "Gabú", "Bissorã", "Bolama", "Cacheu", "Canchungo", "Farim", "Mansôa", "Buba"],
  MR: ["Nouakchott", "Nouadhibou", "Kiffa", "Kaédi", "Rosso", "Zouérate", "Atar", "Sélibaby", "Néma", "Aïoun"],
  CM: ["Douala", "Yaoundé", "Garoua", "Bamenda", "Maroua", "Bafoussam", "Ngaoundéré", "Bertoua", "Kribi", "Limbé"],
};

/** Villes proposées pour un pays (liste vide : la ville se tape librement). */
export const citiesOf = (country?: string | null): string[] => CITIES[country ?? ""] ?? [];
