// Builds the native layer and copies the binaries to resources/native (packaged with the app).
// Two configurations: 64-bit (helper, InputSplitHook64.dll, Probe) and 32-bit
// (InputSplitHook32.dll for 32-bit games, InputSplitProbe32.exe).
//
//   Windows: Visual Studio 2022 (or Build Tools) with the C++ workload → MSVC Release build
//   Linux:   mingw-w64 + CMake (cross-compile, for checks)            → MinGW Release build
//
// CMake does not have to be on PATH on Windows: the copy bundled with Visual Studio is found
// through vswhere.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'native')
const windows = process.platform === 'win32'

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', cwd: root })
}

function onPath(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Visual Studio installation that has the x64 C++ tools, or null. */
function visualStudioPath() {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) return null
  try {
    const output = execFileSync(
      vswhere,
      [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
      ],
      { encoding: 'utf8' },
    ).trim()
    return output.length > 0 ? output.split(/\r?\n/)[0] : null
  } catch {
    return null
  }
}

function findCmake() {
  if (onPath('cmake')) return 'cmake'
  if (!windows) return null
  const vs = visualStudioPath()
  if (vs === null) return null
  const bundled = join(
    vs,
    'Common7',
    'IDE',
    'CommonExtensions',
    'Microsoft',
    'CMake',
    'CMake',
    'bin',
    'cmake.exe',
  )
  return existsSync(bundled) ? bundled : null
}

const cmake = findCmake()
if (cmake === null) {
  const help = windows
    ? [
        'CMake and the MSVC compiler were not found. Install ONE of:',
        '  • Visual Studio 2022 Build Tools with "Desktop development with C++":',
        '      winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
        '  • or Visual Studio 2022 Community with the same workload.',
        'Then open a new terminal and run "npm run build:native" again.',
      ]
    : ['CMake was not found. Install it (and mingw-w64), e.g.: sudo apt install cmake mingw-w64']
  console.error(help.join('\n'))
  process.exit(1)
}
if (windows && visualStudioPath() === null) {
  console.error(
    'Visual Studio C++ tools were not found (the "Desktop development with C++" workload).\n' +
      'Install them with:\n' +
      '  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
  )
  process.exit(1)
}

function build(bits) {
  const buildDir = join(
    source,
    windows ? (bits === 64 ? 'build' : 'build32') : `build-mingw${bits === 64 ? '' : '32'}`,
  )
  const configure = ['-S', source, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release']
  if (windows) configure.push('-A', bits === 64 ? 'x64' : 'Win32')
  else {
    const toolchain = bits === 64 ? 'mingw-w64-x86_64.cmake' : 'mingw-w64-i686.cmake'
    configure.push(`-DCMAKE_TOOLCHAIN_FILE=${join(source, 'cmake', toolchain)}`)
  }
  run(cmake, configure)
  run(cmake, ['--build', buildDir, '--config', 'Release', '--parallel'])
  return join(buildDir, 'bin')
}

const bin64 = build(64)
const bin32 = build(32)

const target = join(root, 'resources', 'native')
mkdirSync(target, { recursive: true })
const outputs = [
  [bin64, 'inputsplit-helper.exe'],
  [bin64, 'InputSplitHook64.dll'],
  [bin32, 'InputSplitHook32.dll'],
]
for (const [dir, file] of outputs) {
  copyFileSync(join(dir, file), join(target, file))
  console.log(`copied ${file} → resources/native/`)
}
console.log(
  `\nDone. The test games are ${join(bin64, 'InputSplitProbe.exe')} and ${join(bin32, 'InputSplitProbe32.exe')}`,
)
