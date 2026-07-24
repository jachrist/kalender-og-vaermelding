// Små hjelpere for HTTP-responser i Express.
//
// Rutehandlere returnerer et objekt { status, jsonBody } (via json()/error()),
// og withHandler() sender det til Express-responsen.

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

// Wrapper som gjør en (req) => { status, jsonBody }-handler til en Express-handler
// og fanger HttpError + uventede feil til pene JSON-responser.
function withHandler(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req);
      if (!result) return res.status(204).end();
      res.status(result.status || 200).json(result.jsonBody);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("Uventet feil:", err);
      res.status(500).json({ error: "Intern feil" });
    }
  };
}

module.exports = { json, error, HttpError, withHandler };
