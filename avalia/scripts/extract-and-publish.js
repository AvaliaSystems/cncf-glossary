const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');
const yaml = require('js-yaml');
var fm = require('front-matter');

function slugify(str) {
  str = str.replace(/^\s+|\s+$/g, ''); // trim
  str = str.toLowerCase();

  // remove diacritical marks
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  str = str
    .replace(/[^a-z0-9 -]/g, '') // remove invalid chars
    .replace(/\s+/g, '-') // collapse whitespace and replace by -
    .replace(/-+/g, '-'); // collapse dashes

  return str;
}

function extractYAMLFrontMatter(markdown) {
  const { attributes, body } = fm(markdown);
  return { frontMatter: attributes, markdown: body };
}

function removeFirstLine(str) {
  return str.replace(/^\s*[\r\n]/g, '');
}

function extractMarkdownData(markdown) {
  const { frontMatter, markdown: markdownWithoutYAML } = extractYAMLFrontMatter(markdown);

  if (frontMatter.tags) {
    frontMatter.tags = frontMatter.tags.filter((t) => t.trim() != '');
  }

  const titleRegex = /^#\s(.*)$/m;
  const sectionRegex = /^##\s(.*?)\n(.*?)(?=##|$(?![^]))/gms;

  const titleMatch = markdownWithoutYAML.match(titleRegex);
  const title = titleMatch ? titleMatch[1] : '';

  const data = {
    title,
    ...frontMatter,
    markdown: removeFirstLine(markdownWithoutYAML),
  };

  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(markdownWithoutYAML)) !== null) {
    data[sectionMatch[1].trim().toLowerCase().replace(/\s+/g, '_')] = sectionMatch[2].trim();
  }

  const dataWithLowerCaseProps = {};
  for (const key in data) {
    dataWithLowerCaseProps[key.toLowerCase()] = data[key];
  }

  return dataWithLowerCaseProps;
}

const processFile = async (file) => {
  console.log(`Processing ${file} ...`);
  const filePath = path.resolve(file);
  const relativePath = path.relative('../', file);
  const markdownWithRelativeLinks = await fs.readFile(filePath, 'utf-8');

  const baseUrl = `https://glossary.cncf.io/${relativePath.replace(/^\.\.\//, '')}`;
  const regexPattern = /\]\(([^ )]+)(?: "([^"]*)")?\)/g;
  const markdown = markdownWithRelativeLinks.replace(regexPattern, (match, relativeUrl, title) => {
    const absoluteUrl = new URL(relativeUrl, baseUrl);
    if (title) {
      return `](${absoluteUrl} "${title}")`;
    }
    return `](${absoluteUrl})`;
  });

  const data = extractMarkdownData(markdown);
  data.slug = filePath.match(/\/([^\/]+)\.[^.]+$/)?.[1] ?? '';
  return {
    url: path.relative('../', file).replace(/^..\/content\/en\/(.*).md$/, 'https://glossary.cncf.io/$1'),
    srcUrl: path.relative('../', file).replace(/^..\/content\/(.*)\.md$/, 'https://github.com/cncf/glossary/blob/main/content/$1.md'),
    ...data,
  };
};

const extract = async () => {
  const searchPath = '../../content/en/*.md';
  const outputFile = 'patterns.json';

  const files = await glob(searchPath);
  const results = [];
  for (const file of files) {
    if (file.indexOf('/_') === -1) {
      const result = await processFile(file);
      results.push(result);
    }
  }
  await fs.writeFile(outputFile, JSON.stringify(results, null, 2));
  return results;
};

const publish = async (patterns) => {
  for (const pattern of patterns) {
    const payload = {
      uid: pattern.slug,
      title: pattern.title,
      summary: pattern.what_it_is || pattern.markdown,
      catalog: 'CNCF Cloud Native Glossary',
      properties: {
        ...pattern,
      },
    };

    const PUBLISH_URL = `${process.env.DXHUB_KB_API_URL}/api/patterns`;
    const response = await fetch(PUBLISH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.DXHUB_KB_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    console.log(`POSTed ${pattern.slug}, status: ${response.status}`);
  }
};

const main = async () => {
  const patterns = await extract();
  await publish(patterns);
};

main()
  .then(() => console.log('Done.'))
  .catch((e) => console.log(e));
