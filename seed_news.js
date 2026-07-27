import "dotenv/config";
import supabase from "./config/Supabase.js";

async function seed() {
  console.log("Seeding campus_news table...");

  const { data: existing } = await supabase
    .from("campus_news")
    .select("id");

  if (existing && existing.length > 0) {
    console.log("campus_news table already has entries. Skipping seeding.");
    return;
  }

  const mockNews = [
    {
      title: "Redefining Innovation: New Research Center Set to Open in IIT BBS Campus",
      category: "Academic",
      subject: "In a significant move towards fostering cutting-edge research and interdisciplinary collaboration, IIT Bhubaneswar is proud to announce the upcoming inauguration of its state-of-the-art Advanced Innovation Center.\n\nThis facility represents a multi-million dollar investment into the future of engineering and scientific exploration in the region.\n\nThe center, spanning over 50,000 square feet, will house dedicated laboratories for Artificial Intelligence, Sustainable Energy, and Nano-technology. According to the Director, the goal is to provide students and faculty with the tools necessary to compete on a global scale while addressing local challenges.\n\n\"This isn't just about new buildings; it's about the ideas that will be born within these walls and their impact on society.\"\n\nConstruction is expected to conclude by the end of the semester, with a grand opening ceremony planned for early next year. The administration has also hinted at new partnership programs with leading tech giants to offer internship opportunities directly within the new research wings.\n\nStudents are encouraged to apply for research assistant positions starting next week. The selection process will be rigorous, focusing on academic excellence and a demonstrated passion for innovation.",
      photos: ["https://ccjygkgrhtbyavfzayvg.supabase.co/storage/v1/object/public/Lost_and_Found/lost_items/22cs01031_iitbbs_ac_in_1784916228161.jpeg"],
      writer_name: "IIT News Team",
      writer_role: "Official Press Release",
      writer_profile_photo: "https://ccjygkgrhtbyavfzayvg.supabase.co/storage/v1/object/public/Lost_and_Found/lost_items/22cs01031_iitbbs_ac_in_1780392581501.png"
    },
    {
      title: "Convocation Schedule Announced",
      category: "Campus Life",
      subject: "Convocation ceremony of IIT is scheduled for next month. Please check details and register on the central portal.",
      photos: [],
      writer_name: "Administration",
      writer_role: "Registrar Office",
      writer_profile_photo: ""
    },
    {
      title: "End Semester Timetable Published",
      category: "Academic",
      subject: "The final timetable for the end semester exams has been uploaded. Students are advised to verify slots.",
      photos: [],
      writer_name: "Academic Section",
      writer_role: "Academic Affairs",
      writer_profile_photo: ""
    }
  ];

  const { error } = await supabase
    .from("campus_news")
    .insert(mockNews);

  if (error) {
    console.error("Error seeding campus_news:", error);
  } else {
    console.log("Seeded campus_news table successfully!");
  }
}

seed().catch(console.error);
