function success(data, message = "OK") {
  return { success: true, data, message };
}

function fail(message, error_code) {
  return { success: false, data: null, message, error_code };
}

module.exports = { success, fail };
