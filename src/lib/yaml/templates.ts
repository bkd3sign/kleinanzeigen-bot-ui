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
 * Templates follow the pattern tpl_*.yaml.
 */
export function findTemplateFiles(workspace: string): string[] {
  const templatesDir = getTemplatesDir(workspace);
  fs.mkdirSync(templatesDir, { recursive: true });

  const entries = fs.readdirSync(templatesDir, { withFileTypes: true });
  return entries
    .filter(
      (e) =>
        e.isFile() &&
        e.name.startsWith('tpl_') &&
        e.name.endsWith('.yaml'),
    )
    .map((e) => path.join(templatesDir, e.name))
    .sort();
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
