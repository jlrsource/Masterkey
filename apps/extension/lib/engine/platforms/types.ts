/**
 * Plattform-hint: små, valgfrie tillegg for plattformer som avviker fra web-standardene.
 * Kjernemotoren bygger på merkelapper og ARIA (role="option", "listbox", "combobox" …), og
 * fungerer uten hint. Hint gjør den bare sikrere der en plattform har egne konvensjoner.
 *
 * Selektorene er så spesifikke (f.eks. Workdays data-automation-id) at de er trygge å bruke
 * på alle sider, så hint er ikke knyttet til domenet (Workday kjører på mange domener).
 */
export interface PlatformHints {
  name: string;
  /** Container rundt hvert felt. Valget i et søkefelt vises alltid her, så vi kan sjekke strengt. */
  fieldContainer?: string;
  /** Feltnavn ut fra containeren (f.eks. «jobtitle» fra formField-jobTitle), mappet til felttyper i blokker. */
  fieldName?: (el: Element) => string | null;
  fieldNames?: Record<string, string>;
  /** Ekstra selektorer for alternativer i lister, i tillegg til role="option". */
  options?: string[];
  /** Raden et alternativ står i, når radioknapp og tekst er søsken. */
  optionRows?: string[];
  /** Elementer i feltet som betyr at tekstfeltet er et søkefelt (man må velge fra listen). */
  searchInputMarkers?: string;
  /** Lister/beholdere som ikke skal regnes som «valgt verdi» i feltet. */
  listContainers?: string[];
  /** Feilmeldinger som vises når et felt ikke godtas. */
  errors?: string[];
}
