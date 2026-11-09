## Mini-Project 3 Proposal

# What I am building: 
- I'm building a tool to track F1 driver's performances side by side in different Grand Prix races. 

# Who it is for:
- This tool is intended to be used by myself and fellow F1 fans to stay up to date on specifics around driver performances. Oftentimes, it can be difficult to do specific driver comparisons so this tool should be able to help long-time and new fans alike with understanding driver timings. The tool will also help new fans get acquainted with the sport by looking at specifics of recent racing history

# The API: its name, its docs link, one URL you opened in the browser, and the fields in its response that you will use
- I plan on using the F1 open API from the free API list to do this project. 
- One url I opened in browser is the following: https://api.openf1.org/v1/drivers?session_key=9472
- This URL links to the driver info, and I'll be using driver_number, full_name, and team_name as an example of at least a few response fields that I'll be using

# What the user chooses: the search, filter or choice that changes what the page asks for or shows
- The user will be able to choose specific races and then be able to filter other information like drivers and specific laps to view comparisons.

# What the page works out: the answer computed from the data, such as a comparison, a total, a ranking or a recommendation
- The page should workout an average lap time for each driver in every Grand Prix they've competed in. Based on that, users can see a ranking based on lap time only.

# Features: three to five things the tool will do
- Filtering based on Grand Prix
- Side-by-side visual comparison of drivers
- A racing graphic with a track and cars somewhere on the screen

# What I do not know yet: the JavaScript you expect to have to figure out
- I'll need to figure out where in the JavaScript the calculations are done around average lap times. I expect that this will likely be a simple function, but it will be critical to ensure that the calculations are done by race, not for the total of the season.