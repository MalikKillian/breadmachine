import React from "react";
import {hydrateRoot} from "react-dom/client";
import CandyBar from '../pages/candybar'

// IMPORTANT: This is the part that makes the page reactive
hydrateRoot(document.getElementById("root"), <CandyBar/>);
