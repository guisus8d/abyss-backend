const MIN_VERSION = process.env.MIN_APP_VERSION || '1.0.0';

function parseVersion(v) {
  return String(v).split('.').map(Number);
}

function isOutdated(clientVersion, minVersion) {
  const [cMaj, cMin, cPatch] = parseVersion(clientVersion);
  const [mMaj, mMin, mPatch] = parseVersion(minVersion);
  if (cMaj !== mMaj) return cMaj < mMaj;
  if (cMin !== mMin) return cMin < mMin;
  return cPatch < mPatch;
}

module.exports = function checkAppVersion(req, res, next) {
  const clientVersion = req.headers['x-app-version'];

  // Sin header → request de web/Postman, dejar pasar
  if (!clientVersion) return next();

  if (isOutdated(clientVersion, MIN_VERSION)) {
    return res.status(426).json({
      error:   'version_outdated',
      message: 'Actualiza la app para continuar',
    });
  }

  next();
};
