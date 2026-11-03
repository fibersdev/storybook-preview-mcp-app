// A `title:` inside a story's args must not be taken for the file's title.
import { Card } from "./Card";

export default { title: "Cards/Card", component: Card };

export const WithTitle = { args: { title: "Hello", body: "A card." } };

export const Renamed = { name: "A renamed story", args: { title: "Renamed", body: "Named." } };
