import fs from 'fs';
import path from 'path';

/**
 * Get the templates directory path for a workspace.
 */
export function getTemplatesDir(workspace: string): string {
  return path.join(workspace, 'ads', 'templates');
}

/**
 * Find all template YAML files in a workspace's templates directory.
 * Supports both legacy flat files (tpl_*.yaml) and directory-based templates
 * (tpl_{slug}/tpl_{slug}.yaml).
 */
export function findTemplateFiles(workspace: string): string[] {
  const templatesDir = getTemplatesDir(workspace);
  fs.mkdirSync(templatesDir, { recursive: true });

  const results: string[] = [];
  const entries = fs.readdirSync(templatesDir, { withFileTypes: true });

  for (const e of entries) {
    if (e.isFile() && e.name.startsWith('tpl_') && e.name.endsWith('.yaml')) {
      results.push(path.join(templatesDir, e.name));
    } else if (e.isDirectory() && e.name.startsWith('tpl_')) {
      const yamlFile = path.join(templatesDir, e.name, `${e.name}.yaml`);
      if (fs.existsSync(yamlFile)) {
        results.push(yamlFile);
      }
    }
  }

  return results.sort();
}

/**
 * Locate a single template YAML by slug.
 * Prefers directory-based (new format), falls back to flat file (legacy).
 */
export function findTemplateFile(templatesDir: string, slug: string): string | null {
  const dirBased = path.join(templatesDir, `tpl_${slug}`, `tpl_${slug}.yaml`);
  if (fs.existsSync(dirBased)) return dirBased;
  const flat = path.join(templatesDir, `tpl_${slug}.yaml`);
  if (fs.existsSync(flat)) return flat;
  return null;
}

/**
 * Generate a filesystem-safe slug from a template name.
 */
export function slugFromName(name: string): string {
  const raw = name
    .toLowerCase()
    .replace(/ /g, '_')
    .replace(/\u2013/g, '') // en-dash
    .replace(/\u2014/g, '') // em-dash
    .slice(0, 60);
  return raw.replace(/[^a-z0-9_]/g, '');
}
