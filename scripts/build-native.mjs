// Builds the native layer and copies the binaries to resources/native (packaged with the app).
//
//   Windows: Visual Studio 2022 (or Build Tools) + CMake      → MSVC Release build
//   Linux:   mingw-w64 + CMake (cross-compile, for checks)    → MinGW Release build
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'native')
const windows = process.platform === 'win32'
const buildDir = join(source, windows ? 'build' : 'build-mingw')

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', cwd: root })
}

const configure = ['-S', source, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release']
if (windows) configure.push('-A', 'x64')
else configure.push(`-DCMAKE_TOOLCHAIN_FILE=${join(source, 'cmake', 'mingw-w64-x86_64.cmake')}`)
run('cmake', configure)
run('cmake', ['--build', buildDir, '--config', 'Release', '--parallel'])

const target = join(root, 'resources', 'native')
mkdirSync(target, { recursive: true })
for (const file of ['inputsplit-helper.exe', 'InputSplitHook64.dll']) {
  copyFileSync(join(buildDir, 'bin', file), join(target, file))
  console.log(`copied ${file} → resources/native/`)
}
