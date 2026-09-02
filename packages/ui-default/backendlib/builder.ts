import { tmpdir } from 'os';
import {
  basename, join, relative, resolve,
} from 'path';
import {
  Context, fs, Handler, Logger, NotFoundError, param, SettingModel, sha1,
  size, SystemModel, Types, UiContextBase,
} from 'hydrooj';
import esbuild from 'esbuild';

declare module 'hydrooj' {
  interface UI {
    esbuildPlugins?: esbuild.Plugin[];
  }
  interface SystemKeys {
    'ui-default.nav_logo_dark': string;
  }
  interface UiContextBase {
    constantVersion?: string;
    localeVersions?: Record<string, string>;
  }
}

// Keep the currently published bundle stable while a new bundle is assembled.
// buildUI is asynchronous and its output is served concurrently by the HTTP
// handlers, so mutating these maps in place can expose a partial entry.js.
let vfs: Record<string, string> = {};
let hashes: Record<string, string> = {};
const logger = new Logger('ui');
const tmp = tmpdir();

const federationPlugin: esbuild.Plugin = {
  name: 'federation',
  setup(b) {
    const packages = {
      'react/jsx-runtime': 'jsxRuntime',
      react: 'React',
      'react-dom/client': 'ReactDOM',
      'react-dom': 'ReactDOM',
      jquery: '$',
    };
    b.onResolve({ filter: /^@hydrooj\/ui-default/ }, () => ({
      path: 'api',
      namespace: 'ui-default',
    }));
    for (const key in packages) {
      b.onResolve({ filter: new RegExp(`^${key}$`) }, () => ({
        path: packages[key],
        namespace: 'ui-default',
      }));
    }
    b.onLoad({ filter: /.*/, namespace: 'ui-default' }, (args) => {
      if (args.path === 'api') {
        return {
          contents: 'module.exports = window.HydroExports;',
          loader: 'tsx',
        };
      }
      return {
        contents: `module.exports = window.HydroExports['${args.path}'];`,
        loader: 'tsx',
      };
    });
  },
};

const build = async (contents: string) => {
  const res = await esbuild.build({
    tsconfigRaw: '{"compilerOptions":{"experimentalDecorators":true}}',
    format: 'iife' as 'iife',
    bundle: true,
    outdir: tmp,
    sourcemap: SystemModel.get('ui-default.nosourcemap') ? false : 'external',
    splitting: false,
    write: false,
    target: ['chrome65'],
    plugins: [
      ...(global.Hydro.ui.esbuildPlugins || []),
      federationPlugin,
    ],
    minify: !process.env.DEV,
    stdin: {
      contents,
      sourcefile: 'stdin.ts',
      resolveDir: tmp,
      loader: 'ts',
    },
  });
  if (res.errors.length) console.error(res.errors);
  if (res.warnings.length) console.warn(res.warnings);
  return res;
};

const applyCss = (css: string) => `
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
`;

export async function buildUI() {
  const start = Date.now();
  let totalSize = 0;
  const entryPoints: string[] = [];
  const lazyModules: string[] = [];
  const nextVfs: Record<string, string> = {};
  const nextHashes: Record<string, string> = {};
  for (const addon of Object.values(global.addons) as string[]) {
    let publicPath = resolve(addon, 'frontend');
    if (!fs.existsSync(publicPath)) publicPath = resolve(addon, 'public');
    if (!fs.existsSync(publicPath)) continue;
    const targets = fs.readdirSync(publicPath);
    for (const target of targets) {
      if (/\.page\.[jt]sx?$/.test(target)) entryPoints.push(join(publicPath, target));
      if (/\.lazy\.[jt]sx?$/.test(target)) lazyModules.push(join(publicPath, target));
    }
  }
  function addFile(name: string, content: string) {
    nextVfs[name] = content;
    nextHashes[name] = sha1(content).substring(0, 8);
    logger.info('+ %s-%s: %s', name, nextHashes[name].substring(0, 6), size(content.length));
    totalSize += content.length;
  }
  for (const m of lazyModules) {
    const name = basename(m).split('.')[0];
    const { outputFiles } = await build(`window.lazyModuleResolver['${name}'](require('${relative(tmp, m).replace(/\\/g, '\\\\')}'))`);
    const css = outputFiles.filter((i) => i.path.endsWith('.css')).map((i) => i.text).join('\n');
    for (const file of outputFiles) {
      if (file.path.endsWith('.css')) continue;
      addFile(basename(m).replace(/\.[tj]sx?$/, '.js'), (css ? applyCss(css) : '') + file.text);
    }
  }
  const localeVersions: Record<string, string> = {};
  for (const lang in global.Hydro.locales) {
    if (!/^[a-zA-Z_]+$/.test(lang)) continue;
    if (!global.Hydro.locales[lang].__interface) continue;
    const str = `window.LOCALES=${JSON.stringify(global.Hydro.locales[lang][Symbol.for('iterate')])};`;
    addFile(`lang-${lang}.js`, str);
    localeVersions[lang] = nextHashes[`lang-${lang}.js`];
  }
  const entry = await build([
    `window.lazyloadMetadata = ${JSON.stringify(nextHashes)};`,
    `window.LANGS=${JSON.stringify(SettingModel.langs)};`,
    ...entryPoints.map((i) => `import '${relative(tmp, i).replace(/\\/g, '\\\\')}';`),
  ].join('\n'));
  const pages = entry.outputFiles.filter((i) => i.path.endsWith('.js')).map((i) => i.text);
  const css = entry.outputFiles.filter((i) => i.path.endsWith('.css')).map((i) => i.text);
  addFile('entry.js', `window._hydroLoad=()=>{
    ${css.length ? applyCss(css.join('\n')) : ''}
    ${pages.join('\n')}
  };`);
  // Publish the complete generated bundle in one synchronous operation. Any
  // request racing this build continues to use the previous complete bundle.
  vfs = nextVfs;
  hashes = nextHashes;
  UiContextBase.constantVersion = nextHashes['entry.js'];
  UiContextBase.localeVersions = localeVersions;
  logger.success('UI addons built in %d ms (%s)', Date.now() - start, size(totalSize));
}

class UiConstantsHandler extends Handler {
  noCheckPermView = true;
  skipRealnameCheck = true;

  @param('name', Types.Filename)
  async all(domainId: string, name: string) {
    this.response.type = 'application/javascript';
    if (!vfs[name]) throw new NotFoundError(name);
    this.response.addHeader('ETag', hashes[name]);
    this.response.body = vfs[name];
    this.response.addHeader('Cache-Control', 'public, max-age=86400');
  }
}

export async function apply(ctx: Context) {
  ctx.Route('constant', '/lazy/:version/:name', UiConstantsHandler);
  ctx.Route('constant', '/resource/:version/:name', UiConstantsHandler);
  ctx.on('app/started', buildUI);
  const debouncedBuildUI = ctx.debounce(buildUI, 2000);
  const triggerHotUpdate = (path?: string) => {
    if (path && !path.includes('/ui-default/') && !path.includes('/public/') && !path.includes('/frontend/')) return;
    debouncedBuildUI();
  };
  ctx.on('system/setting', () => triggerHotUpdate());
  ctx.on('system/setting-loaded', () => triggerHotUpdate());
  ctx.on('app/watch/change', triggerHotUpdate);
  ctx.on('app/watch/unlink', triggerHotUpdate);
  ctx.on('app/i18n/update', debouncedBuildUI);
  debouncedBuildUI();
}
