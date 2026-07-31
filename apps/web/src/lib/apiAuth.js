let authState = {
  username: null,
  getAccessToken: null,
};

export function setApiAuth(next) {
  authState = { ...authState, ...next };
}

export function getApiAuth() {
  return authState;
}
