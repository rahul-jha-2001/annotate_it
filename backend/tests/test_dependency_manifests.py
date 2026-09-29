import re
import tomllib
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def dependency_name(requirement: str) -> str:
    match = re.match(r"[A-Za-z0-9_.-]+", requirement.strip())
    if match is None:
        raise ValueError(f"invalid dependency requirement: {requirement!r}")
    return match.group(0).lower().replace("_", "-")


class DependencyManifestTests(unittest.TestCase):
    def test_docker_requirements_include_every_runtime_dependency(self):
        with (BACKEND_ROOT / "pyproject.toml").open("rb") as handle:
            project = tomllib.load(handle)

        runtime_dependencies = {
            dependency_name(requirement)
            for requirement in project["project"]["dependencies"]
        }
        docker_dependencies = {
            dependency_name(line)
            for line in (BACKEND_ROOT / "requirements.txt").read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }

        self.assertEqual(
            runtime_dependencies - docker_dependencies,
            set(),
            "requirements.txt is missing dependencies installed by the local uv environment",
        )


if __name__ == "__main__":
    unittest.main()
