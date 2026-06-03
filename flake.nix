{
  description = "Doit Taskwarrior mobile web MVP";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.cargo
            pkgs.clippy
            pkgs.just
            pkgs.rustc
            pkgs.rustfmt
            pkgs.taskwarrior3
          ];

          shellHook = ''
            mkdir -p .dev/task
            test -f .dev/taskrc || cp .dev/taskrc.example .dev/taskrc
            export TASKRC="$PWD/.dev/taskrc"
            export TASKDATA="$PWD/.dev/task"
            export TASK_SYNC=false
          '';
        };
      });
}
