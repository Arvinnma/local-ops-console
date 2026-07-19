const parameters = new URLSearchParams(location.search);
const language = parameters.get("lang") === "en-US" ? "en-US" : "zh-CN";

document.documentElement.lang = language;
if (language === "en-US") {
  document.querySelectorAll("[data-en]").forEach((element) => {
    element.textContent = element.dataset.en;
  });
  document.querySelectorAll("[data-en-aria]").forEach((element) => {
    element.setAttribute("aria-label", element.dataset.enAria);
  });
}

const reason = parameters.get("reason");
const reasonElement = document.querySelector("#offline-reason");
if (reason && reasonElement) {
  reasonElement.textContent = reason;
  reasonElement.hidden = false;
}
