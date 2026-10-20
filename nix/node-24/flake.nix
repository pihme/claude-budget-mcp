{
  description = "claude-budget-mcp: Node.js 24 for the newer CI leg";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin"];
      forAll = f: nixpkgs.lib.genAttrs systems (system:
        f system nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (system: pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_24 ];
        };
      });
    };
}
