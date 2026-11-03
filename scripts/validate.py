# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "PyYAML==6.0.3",
#   "skills-ref @ git+https://github.com/agentskills/agentskills.git@69ef37e9424c0a7ea9dd2293b559e43ec8176379#subdirectory=skills-ref",
# ]
# ///

"""Validate every installable bundle with the Agent Skills reference library."""
from pathlib import Path
import re
import sys

import yaml
from skills_ref import validate


def validate_bundle(directory: Path) -> list[str]:
    problems = []
    entry = directory / "SKILL.md"
    if not entry.is_file():
        return ["Missing required root SKILL.md"]
    try:
        problems.extend(validate(directory))
        text = entry.read_text(encoding="utf-8")
        header = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
        if not header:
            return problems + ["Frontmatter must use separate --- delimiter lines"]
        metadata = yaml.safe_load(header.group(1))
        if not isinstance(metadata, dict):
            return problems + ["Frontmatter must be a mapping"]
        # The reference parser treats scalars as strings and does not check these
        # optional field types. Enforce the published specification as well.
        for field in ("name", "description", "license", "compatibility", "allowed-tools"):
            if field in metadata and not isinstance(metadata[field], str):
                problems.append(f"{field} must be a string")
        if "compatibility" in metadata and isinstance(metadata["compatibility"], str) and not metadata["compatibility"].strip():
            problems.append("compatibility must be non-empty when provided")
        if "metadata" in metadata:
            values = metadata["metadata"]
            # The skills CLI hides a skill only when metadata.internal is the boolean true.
            if not isinstance(values, dict) or not all(
                isinstance(key, str)
                and (isinstance(value, str) or (key == "internal" and isinstance(value, bool)))
                for key, value in values.items()
            ):
                problems.append("metadata must map string keys to string values, except a boolean internal")
    except (OSError, ValueError, TypeError, yaml.YAMLError) as error:
        problems.append(f"Cannot validate SKILL.md: {error}")
    return problems


def validate_repository(root: Path) -> tuple[int, list[str]]:
    skills = root / "skills"
    if not skills.is_dir():
        return 0, []
    bundles = sorted(path for path in skills.iterdir() if path.is_dir())
    problems = []
    for bundle in bundles:
        for problem in validate_bundle(bundle):
            problems.append(f"{bundle.name}: {problem}")
        for entry in bundle.rglob("SKILL.md"):
            if entry != bundle / "SKILL.md":
                problems.append(f"{bundle.name}: nested SKILL.md is not allowed by this repository: {entry.relative_to(bundle)}")
    return len(bundles), problems


def main() -> int:
    count, problems = validate_repository(Path(__file__).resolve().parent.parent)
    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        print(f"Agent Skills validation failed: {len(problems)} problem(s) across {count} bundles.", file=sys.stderr)
        return 1
    print(f"All {count} bundles pass Agent Skills format validation (skills-ref plus field-type checks).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
