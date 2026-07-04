# Authelia Config GUI

Simple web interface to upload, edit, generate,
Configuration Files (
	(configuration.yml)
or
(users_database.yml)) which are copied onto the service.
The Backend serves APIs alongwith frontend statically served locally;
certainly no compilation involved whatsoever!
All passwords hashing performed remotely since authentication services were deployed outside our realm.

---

#### Launch Instructions
Launch containers :
docker-compose up --build
Then visit localhost:http//8089 (Port mapped according to docker.compose.yml )
Without Containers?
pip install requirements.txt
then uvicorn launch_app.run():app --reloader == --port== 8080

-----

#### How-To Usage Steps
Select whichever configuration file shall edited ; select Upload button ? Then Select appropriate example template !!!!
Fill-out Forms Fields properly! Click Apply Changes Button!! And finally Download Result Copy Paste Into Target Server !! All Done !!!
Note however advanced settings remain unchanged till manually overridden elsewhere , please refer Advanced Section mentioned below.
Password Field filled clearly displays Hash Algorithm Argon2Id Used By Standard Settings Of Authentication Service Providers As Defined Inside Specified Parameters Provided Via FrontEnd Interface Which Is Fully Automated During Generation Phase Based Upon Input Given Within Form Controls Present At Top Level Screen Display Area Using RuMealy.Yaml Library Ensuring Integrity Preservation While Applying Any Modification Made Through These Interfaces Except Those Direct Manipulations Involved Underneath Raw Editing Mode Activated Once Checked Box Called \Advanced Setup Enabled Flag Has Been Selected Prior Execution Step Occurs Where Users May Choose Their Preference Regarding What Kind Details They Want Included Such As Domain Policy Subject Resource Networks Method Queries Resources Complex Subjects Etc...
Remember though while applying modifications made possible via standard controls listed herein certain aspects related specifically towards AccessControl Rule Management Are Automatically Regenerated Since Certain Keys Like Methods QuerieResources NetworkSubjects Require More Sophisticated Handling That Goes Beyond Simple Template Matching Capabilities Offered Here Therefore Please Refer Back Again Later Should Need Further Assistance Understanding Behavior Related To Customizing Individual Components Accordingly.
Please Take Care About Compatibility Issues Between Versions Being Utilized Currently Because Some Features Might Have Changed Over Time So Ensure Your System Version Matches Requirements Before Proceeding Forward Unless Working Around Known Bugs Instead Consider Switching Modes Manual Override Option Whenever Necessary.
Finally Remember Validation Process Conducted Ahead Deployments Will Verify Entire Configuration Against Schema Specifications Prescribed By Official Documentation Thus Make Sure Everything Appears Correct According To Guidelines Issued Elsewise Deployment Could Fail Unexpected Ways Leading Potential Security Breaches Hence Double Check Every Detail Thoroughly Until Complete Satisfaction Achieved.