"""Validate the exported contract schema subset using Python's standard library only.

This checks Phase 0 fixtures and rejects unknown contract versions. It is not a
general JSON Schema engine: unsupported validation keywords fail explicitly.
"""
import datetime
import json
import math
import re
import sys
import uuid


SUPPORTED = {
    "$schema", "$id", "title", "description", "type", "properties", "required",
    "additionalProperties", "propertyNames", "items", "minItems", "maxItems", "minLength",
    "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum",
    "exclusiveMaximum", "const", "enum", "anyOf", "x-bigint-max",
}


def validate(schema, value, path="$"):
    if schema is True:
        return
    if schema is False:
        raise ValueError(f"{path}: schema rejects value")
    unknown = set(schema) - SUPPORTED
    if unknown:
        raise ValueError(f"{path}: unsupported schema keywords {sorted(unknown)}")
    if "anyOf" in schema:
        for branch in schema["anyOf"]:
            try:
                validate(branch, value, path)
                break
            except ValueError:
                continue
        else:
            raise ValueError(f"{path}: no anyOf branch matched")
    types = {
        "object": lambda item: isinstance(item, dict),
        "array": lambda item: isinstance(item, list),
        "string": lambda item: isinstance(item, str),
        "number": lambda item: isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item),
        "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
        "boolean": lambda item: isinstance(item, bool),
        "null": lambda item: item is None,
    }
    if "type" in schema:
        allowed_types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(types[type_name](value) for type_name in allowed_types):
            raise ValueError(f"{path}: wrong type")
    if "const" in schema and (type(value) is not type(schema["const"]) or value != schema["const"]):
        # JSON has a single number type; booleans still must not equal 1.
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != schema["const"]:
            raise ValueError(f"{path}: wrong constant")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: unknown enum value")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                raise ValueError(f"{path}.{key}: required field missing")
        for key, child in value.items():
            if "propertyNames" in schema:
                validate(schema["propertyNames"], key, f"{path}:propertyName")
            if key in properties:
                validate(properties[key], child, f"{path}.{key}")
            elif "additionalProperties" in schema:
                validate(schema["additionalProperties"], child, f"{path}.{key}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", math.inf):
            raise ValueError(f"{path}: invalid array size")
        if "items" in schema:
            for index, child in enumerate(value):
                validate(schema["items"], child, f"{path}[{index}]")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", math.inf):
            raise ValueError(f"{path}: invalid string size")
        pattern = schema.get("pattern")
        if pattern and not re.search(pattern, value, flags=re.ASCII):
            raise ValueError(f"{path}: string pattern mismatch")
        if "x-bigint-max" in schema and (not value.isascii() or not value.isdigit() or int(value) > int(schema["x-bigint-max"])):
            raise ValueError(f"{path}: bigint out of range")
        if schema.get("format") == "uuid":
            try:
                parsed = uuid.UUID(value)
                if str(parsed) != value.lower():
                    raise ValueError("not canonical")
            except ValueError as error:
                raise ValueError(f"{path}: invalid uuid") from error
        if schema.get("format") == "date-time":
            try:
                parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError("timezone required")
            except ValueError as error:
                raise ValueError(f"{path}: invalid datetime") from error
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        if value < schema.get("minimum", -math.inf) or value > schema.get("maximum", math.inf):
            raise ValueError(f"{path}: number out of range")
        if value <= schema.get("exclusiveMinimum", -math.inf) or value >= schema.get("exclusiveMaximum", math.inf):
            raise ValueError(f"{path}: exclusive number bound failed")


def main():
    # Node supplies UTF-8 JSON; do not depend on the Windows console code page.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    request = json.load(sys.stdin)
    results = []
    for case in request["cases"]:
        rejection = None
        try:
            validate(request["schemas"][case["contract"]], case["data"])
            accepted = True
        except ValueError as error:
            rejection = str(error)
            accepted = False
        if accepted != case["valid"]:
            raise ValueError(f"Fixture result mismatch: {case['name']}; {rejection or 'unexpected acceptance'}")
        results.append({"name": case["name"], "accepted": accepted})
    print(json.dumps({"passed": len(results), "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
