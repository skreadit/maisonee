import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
if (existsSync(path.join(root, ".env.local"))) process.loadEnvFile(path.join(root, ".env.local"));
const args = process.argv.slice(2);
const command = args[0];
if (!args.includes("--offline-confirmed") || !["backup", "restore"].includes(command)) {
  throw new Error("Arrêtez tous les processus accédant à PGlite puis utilisez : node scripts/backup.mjs backup --offline-confirmed, ou restore --from=backups/<dossier> --to=data/restored --offline-confirmed. L'arrêt n'est pas vérifiable automatiquement.");
}
if (process.env.DATABASE_URL || process.env.APP_MODE !== "demo") {
  throw new Error("Ce script est réservé à PGlite local en mode demo. PostgreSQL nécessite pg_dump/pg_restore.");
}
const within = (base, candidate) => {
  const relative = path.relative(base, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
};
const safePath = (base, candidate) => {
  const resolved = path.resolve(root, candidate);
  if (!within(base, resolved)) throw new Error(`Le chemin doit rester dans ${base}.`);
  return resolved;
};
async function rejectSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Lien symbolique interdit dans une sauvegarde locale.");
    if (entry.isDirectory()) await rejectSymlinks(path.join(directory, entry.name));
  }
}
const backups = path.join(root, "backups");
if (command === "backup") {
  const source = safePath(root, process.env.PGLITE_DATA_DIR || ".data/maisonnee");
  if (!(await stat(source)).isDirectory()) throw new Error("Dossier PGlite introuvable.");
  if (within(source, backups) || source === backups) throw new Error("Le dossier de sauvegarde ne peut pas se trouver dans la base.");
  await rejectSymlinks(source);
  const destination = path.join(backups, new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"));
  await mkdir(destination, { recursive: true });
  await cp(source, path.join(destination, "database"), { recursive: true, errorOnExist: true, force: false });
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify({ format: "maisonnee-pglite-offline-v1", createdAt: new Date().toISOString(), source: path.relative(root, source), applicationStoppedByOperator: true }, null, 2));
  console.log(`Sauvegarde locale créée : ${path.relative(root, destination)}. Vérifiez une restauration avant de vous y fier.`);
} else {
  const from = args.find((arg) => arg.startsWith("--from="))?.slice(7);
  const to = args.find((arg) => arg.startsWith("--to="))?.slice(5);
  if (!from || !to) throw new Error("Indiquez --from=backups/<dossier> et --to=data/restored (dossier inexistant).");
  const source = safePath(backups, from);
  const destination = safePath(root, to);
  if (existsSync(destination)) throw new Error("La restauration ne remplace jamais un dossier existant.");
  if (destination === backups || within(backups, destination)) throw new Error("La restauration doit être hors du dossier de sauvegardes.");
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  if (manifest.format !== "maisonnee-pglite-offline-v1") throw new Error("Format de sauvegarde inconnu.");
  await rejectSymlinks(source);
  await cp(path.join(source, "database"), destination, { recursive: true, force: false, errorOnExist: true });
  console.log(`Copie restaurée : ${path.relative(root, destination)}. Démarrez un seul serveur avec PGLITE_DATA_DIR vers ce chemin puis vérifiez comptes, réservations et messages.`);
}
