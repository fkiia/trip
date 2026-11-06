// CloudBase EnvId is public configuration, not a secret. Keep API secrets out of this file.
window.TRIP_CLOUD_CONFIG = {
  envId: location.hostname === 'fkikka-trip-d6ghf0owycf7f2f15-1300619387.tcloudbaseapp.com'
    ? 'fkikka-trip-d6ghf0owycf7f2f15' : '',
  coverApiUrl: location.hostname === 'fkikka-trip-d6ghf0owycf7f2f15-1300619387.tcloudbaseapp.com'
    ? 'https://fkikka-trip-d6ghf0owycf7f2f15-1300619387.ap-shanghai.app.tcloudbase.com/xhs-cover' : '',
  sdkUrl: 'https://static.cloudbase.net/cloudbase-js-sdk/3.10.1/cloudbase.full.js'
};
