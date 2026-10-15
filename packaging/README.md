# Package manager manifests

- `../bucket/inputsplit.json` makes this repository a [Scoop](https://scoop.sh) bucket:
  `scoop bucket add inputsplit https://github.com/narkotrxll/InputSplit`, then
  `scoop install inputsplit/inputsplit`. Older versions in it are fine: installed copies update
  themselves.
- `winget/narkotrxll.InputSplit/<version>/` is the manifest set for
  [winget-pkgs](https://github.com/microsoft/winget-pkgs). To submit a new version, copy the
  folder to `manifests/n/narkotrxll/InputSplit/<version>/` in a fork of winget-pkgs, update the
  version, URL, SHA-256 (from `InputSplit.exe.sha256` on the release) and release date, check it
  with `winget validate` and `winget install --manifest <folder>`, and open a pull request.
  `wingetcreate update narkotrxll.InputSplit --version <v> --urls <installer url> --submit` does
  the same in one step once the first version is accepted.
