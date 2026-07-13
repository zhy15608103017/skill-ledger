export function formatLocalTimestamp(input) {
  if (!input) return "";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);

  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
  ].join(" ");
}

export function formatLocalTimestampForFileName(input) {
  return formatLocalTimestamp(input).replace(/:/g, "-");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
