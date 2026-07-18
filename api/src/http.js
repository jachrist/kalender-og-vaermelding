// Små hjelpere for HTTP-responser i Azure Functions v4.

function json(body, status = 200) {
  return { status, jsonBody: body };
}

function error(status, message) {
  return { status, jsonBody: { error: message } };
}

// Kastes fra hjelpere for å avbryte med en HTTP-status. Fanges i withHandler.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrapper som fanger HttpError og uventede feil til pene JSON-responser.
function withHandler(fn) {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (err) {
      if (err instanceof HttpError) {
        return error(err.status, err.message);
      }
      context.error("Uventet feil:", err);
      return error(500, "Intern feil");
    }
  };
}

module.exports = { json, error, HttpError, withHandler };
