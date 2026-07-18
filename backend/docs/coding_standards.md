# Coding Standards

Use Python 3.12

Use pathlib instead of os whenever possible.

Every public function must contain Google style docstrings.

Every file must have one responsibility.

Every file must remain under 250 lines unless explicitly necessary.

Avoid global state.

Avoid singleton patterns unless required.

Use dependency injection.

Configuration must come from settings.py.

Logging must use logger.py.

No print().

Use logger.

Every API returns Pydantic models.

Every module should be independently testable.

Use descriptive variable names.

Use dataclasses only when appropriate.

Prefer composition over inheritance.

Write code that another engineer can understand in six months.