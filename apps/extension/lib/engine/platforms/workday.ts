import type { PlatformHints } from "./types";

/** Workday: alt identifiseres med data-automation-id. */
export const workday: PlatformHints = {
  name: "Workday",
  fieldContainer: '[data-automation-id^="formField-"]',
  fieldName: (el) => {
    const id = el.closest('[data-automation-id^="formField-"]')?.getAttribute("data-automation-id");
    return id ? id.slice("formField-".length).toLowerCase() : null;
  },
  fieldNames: {
    jobtitle: "title",
    company: "employer",
    companyname: "employer",
    location: "location",
    currentlyworkhere: "current",
    roledescription: "description",
    description: "description",
    startdate: "start",
    enddate: "end",
    school: "school",
    schoolname: "school",
    degree: "degree",
    fieldofstudy: "field",
    gradeaverage: "grade",
    gpa: "grade",
    overallresult: "grade",
    firstyearattended: "start",
    lastyearattended: "end",
    language: "language",
    nativelanguage: "fluent",
    url: "url",
    websiteurl: "url",
  },
  options: ['[data-automation-id="promptOption"]'],
  optionRows: ['[data-automation-id="promptLeafNode"]', '[data-automation-id="menuItem"]'],
  searchInputMarkers: '[data-automation-id*="prompt" i], [data-automation-id*="multiSelect" i]',
  listContainers: ['[data-automation-id="activeListContainer"]', '[data-automation-id="promptLeafNode"]'],
  errors: ['[data-automation-id="errorMessage"]', '[data-automation-id="errorBanner"]'],
};
