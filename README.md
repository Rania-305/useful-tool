# useful-tool

Project Link: https://rania-305.github.io/useful-tool/
Vercel Link: https://useful-tool-alpha.vercel.app/

What the agent built differed from what you expected:
- In this site, I found that the agent tended to add additional text and information that felt unnecessary from a front-end perspective. It would provide additional details about how certain metrics were calculated that were'nt necessarily helpful to users of this tool. I suspect that this is because it was pulling from the larger source of information from the API as opposed to when we usually build projects that gets stored locally. 

Pick one piece of AI output you did not accept as-is. What did it give you, what did you change, and how did you know it needed changing? Point at the commit.
- When initially trying to produce the mock races, the cars were moving way too quickly. This required me to take a look at the JS behind it. Using the agent, I found that the problem was in script.js:796 with const RACE_SPEEDUP = 20;. This ended up being a simple fix and I changed it to const RACE_SPEEDUP = 15;.

If the agent produced acceptable output on the first attempt: what did you do to verify it?
- When the agent first started gathering data from the API, double-checked that it was fetching information from the right source. I also made sure that there were no keys being leaked in any of the code, which ended up not being an issue since this API did not employ a private key.